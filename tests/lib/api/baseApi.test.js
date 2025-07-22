const { BaseApi } = require("../../../lib/api/internal/baseApi");
const { AxiosFactory } = require("../../../lib/api/internal/axiosFactory");
const MockAdapter = require("axios-mock-adapter");
const axios = require("axios");
const { consola } = require("consola");

jest.mock("../../../lib/api/internal/axiosFactory");
jest.mock("consola");

describe("BaseApi", () => {
  let baseApi;
  let mockAxiosInstance;
  let mockAdapter;

  beforeEach(() => {
    baseApi = new BaseApi();
    mockAxiosInstance = axios.create();
    mockAdapter = new MockAdapter(mockAxiosInstance);

    AxiosFactory.createInstance.mockReturnValue(mockAxiosInstance);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe("_makeRequest", () => {
    it("should make a successful GET request", async () => {
      const responseData = { id: 1, name: "test" };
      mockAdapter.onGet("test-endpoint").reply(200, responseData);

      const result = await baseApi._makeRequest("get", "firm", 123, "test-endpoint");

      expect(result.data).toEqual(responseData);
      expect(result.status).toBe(200);
      expect(AxiosFactory.createInstance).toHaveBeenCalledWith("firm", 123);
      expect(consola.debug).toHaveBeenCalledWith(
        expect.stringContaining("Response Status: 200")
      );
    });

    it("should make a successful POST request with data", async () => {
      const requestData = { name: "test", text: "content" };
      const responseData = { id: 1, ...requestData };
      mockAdapter.onPost("test-endpoint", requestData).reply(201, responseData);

      const result = await baseApi._makeRequest("post", "firm", 123, "test-endpoint", requestData);

      expect(result.data).toEqual(responseData);
      expect(result.status).toBe(201);
      expect(mockAdapter.history.post[0].data).toBe(JSON.stringify(requestData));
    });

    it("should make a successful DELETE request", async () => {
      mockAdapter.onDelete("test-endpoint/1").reply(204);

      const result = await baseApi._makeRequest("delete", "firm", 123, "test-endpoint/1");

      expect(result.status).toBe(204);
    });

    it("should include params in request config", async () => {
      const params = { page: 2, per_page: 100 };
      mockAdapter.onGet("test-endpoint").reply(200, []);

      await baseApi._makeRequest("get", "firm", 123, "test-endpoint", null, params);

      expect(mockAdapter.history.get[0].params).toEqual(params);
    });

    it("should include additional config in request", async () => {
      const config = { headers: { "Content-Type": "application/json" } };
      mockAdapter.onPost("test-endpoint").reply(200, {});

      await baseApi._makeRequest("post", "firm", 123, "test-endpoint", {}, null, config);

      expect(mockAdapter.history.post[0].headers["Content-Type"]).toBe("application/json");
    });

    it("should handle unsupported HTTP method", async () => {
      const errorHandlerSpy = jest.spyOn(baseApi, '_responseErrorHandler').mockResolvedValue();
      
      await baseApi._makeRequest("patch", "firm", 123, "test-endpoint");

      expect(errorHandlerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Unsupported HTTP method: patch"
        })
      );
    });

    it("should call _responseErrorHandler on request error", async () => {
      mockAdapter.onGet("test-endpoint").networkError();
      
      const errorHandlerSpy = jest.spyOn(baseApi, '_responseErrorHandler').mockResolvedValue();
      
      await baseApi._makeRequest("get", "firm", 123, "test-endpoint");

      expect(errorHandlerSpy).toHaveBeenCalled();
    });
  });

  describe("_responseErrorHandler", () => {
    it("should handle 404 errors", async () => {
      const error = {
        response: {
          status: 404,
          statusText: "Not Found",
          data: { error: "Resource not found" },
          config: { method: "get", url: "test-url" }
        }
      };

      await baseApi._responseErrorHandler(error);

      expect(consola.debug).toHaveBeenCalledWith(
        "Response Status: 404 (Not Found) - method: get - url: test-url"
      );
      expect(consola.error).toHaveBeenCalledWith(
        'Response Error (404): "Resource not found"'
      );
    });

    it("should handle 400 errors", async () => {
      const error = {
        response: {
          status: 400,
          statusText: "Bad Request",
          data: { error: "Invalid request" },
          config: { method: "post", url: "test-url" }
        }
      };

      await baseApi._responseErrorHandler(error);

      expect(consola.error).toHaveBeenCalledWith(
        'Response Error (400): "Invalid request"'
      );
    });

    it("should handle 401 errors and continue to throw", async () => {
      const error = {
        response: {
          status: 401,
          statusText: "Unauthorized",
          data: { error: "Unauthorized" },
          config: { method: "get", url: "test-url" }
        }
      };

      try {
        await baseApi._responseErrorHandler(error);
        expect.fail('Expected method to throw');
      } catch (thrownError) {
        expect(thrownError).toBe(error);
      }

      expect(consola.debug).toHaveBeenCalledWith(
        'Response Error (401): {"error":"Unauthorized"}'
      );
    });

    it("should handle 422 errors and exit process", async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit called');
      });
      
      const error = {
        response: {
          status: 422,
          statusText: "Unprocessable Entity",
          data: { error: "Validation failed" },
          config: { method: "post", url: "test-url" }
        }
      };

      await expect(baseApi._responseErrorHandler(error)).rejects.toThrow('Process exit called');

      expect(consola.error).toHaveBeenCalledWith(
        'Response Error (422): {"error":"Validation failed"}',
        "\n",
        "You don't have the rights to update the previous parameters"
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      
      mockExit.mockRestore();
    });

    it("should handle 403 errors and exit process", async () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit called');
      });
      
      const error = {
        response: {
          status: 403,
          statusText: "Forbidden",
          data: {},
          config: { method: "get", url: "test-url" }
        }
      };

      await expect(baseApi._responseErrorHandler(error)).rejects.toThrow('Process exit called');

      expect(consola.error).toHaveBeenCalledWith(
        "Error (403): Forbidden access. Terminating process"
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      
      mockExit.mockRestore();
    });

    it("should throw unhandled errors", async () => {
      const error = {
        response: {
          status: 500,
          statusText: "Internal Server Error",
          data: { error: "Server error" },
          config: { method: "get", url: "test-url" }
        }
      };

      try {
        await baseApi._responseErrorHandler(error);
        expect.fail('Expected method to throw');
      } catch (thrownError) {
        expect(thrownError).toBe(error);
      }
    });

    it("should throw network errors without response", async () => {
      const error = new Error("Network Error");

      await expect(baseApi._responseErrorHandler(error)).rejects.toThrow("Network Error");
    });

    it("should log response status when error has response", async () => {
      const error = {
        response: {
          status: 500,
          statusText: "Internal Server Error",
          data: {},
          config: { method: "post", url: "test-url" }
        }
      };

      try {
        await baseApi._responseErrorHandler(error);
      } catch (e) {
        // Expected to throw
      }

      expect(consola.debug).toHaveBeenCalledWith(
        "Response Status: 500 (Internal Server Error) - method: post - url: test-url"
      );
    });
  });

  describe("integration tests", () => {
    it("should handle complete request flow with error", async () => {
      
      mockAdapter.onGet("test-endpoint").reply(404, { error: "Not found" });

      await baseApi._makeRequest("get", "firm", 123, "test-endpoint");

      expect(consola.debug).toHaveBeenCalledWith(
        expect.stringContaining("Response Status: 404")
      );
      expect(consola.error).toHaveBeenCalledWith(
        'Response Error (404): "Not found"'
      );
    });

    it("should handle complete request flow with success", async () => {
      const responseData = { id: 1, name: "success" };
      mockAdapter.onPost("test-endpoint").reply(200, responseData);

      const result = await baseApi._makeRequest("post", "firm", 123, "test-endpoint", { data: "test" });

      expect(result.data).toEqual(responseData);
      expect(consola.debug).toHaveBeenCalledWith(
        expect.stringContaining("Response Status: 200")
      );
    });
  });
});