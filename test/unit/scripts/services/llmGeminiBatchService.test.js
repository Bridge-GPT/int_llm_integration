'use strict';

var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();
var expect = chai.expect;

describe('llmGeminiBatchService', function () {

    var geminiBatchService;
    var mockCreateService;
    var mockLogger;
    var mockErrorHelper;
    var mockNormalizationHelper;

    // Tracks the service callbacks passed to createService
    var capturedCallbacks;
    // The mock service object returned by createService
    var mockServiceInstance;
    // Controls the result returned by service.call()
    var mockCallResult;

    // Mock svc object passed to createRequest
    var mockSvc;
    var mockCredential;

    beforeEach(function () {
        capturedCallbacks = null;

        mockCredential = {
            getPassword: sinon.stub().returns('test-api-key-123'),
            getURL: sinon.stub().returns(null)
        };

        mockSvc = {
            setURL: sinon.stub(),
            setRequestMethod: sinon.stub(),
            addHeader: sinon.stub(),
            getConfiguration: sinon.stub().returns({
                getCredential: sinon.stub().returns(mockCredential)
            })
        };

        mockCallResult = {
            ok: true,
            object: {},
            errorMessage: null,
            error: null
        };

        mockServiceInstance = {
            call: sinon.stub().callsFake(function () {
                return mockCallResult;
            })
        };

        mockCreateService = sinon.stub().callsFake(function (serviceId, callbacks) {
            capturedCallbacks = callbacks;
            return mockServiceInstance;
        });

        mockLogger = {
            error: sinon.stub(),
            warn: sinon.stub(),
            info: sinon.stub(),
            debug: sinon.stub()
        };

        mockErrorHelper = {
            createLLMError: sinon.stub().callsFake(function (message, errorType, status, providerError) {
                var err = new Error(message);
                err.errorType = errorType;
                err.status = status;
                err.providerError = providerError;
                err.isLLMError = true;
                return err;
            }),
            mapProviderError: sinon.stub().callsFake(function (provider, statusCode, errorBody) {
                var err = new Error('Provider error from ' + provider);
                err.errorType = 'ProviderError';
                err.status = statusCode;
                err.providerError = errorBody;
                err.isLLMError = true;
                return err;
            }),
            sanitizeForLogging: sinon.stub().callsFake(function (msg) {
                return msg;
            }),
            ERROR_TYPES: {
                ValidationError: 'ValidationError',
                AuthenticationError: 'AuthenticationError',
                RateLimitError: 'RateLimitError',
                TimeoutError: 'TimeoutError',
                ProviderError: 'ProviderError',
                ConfigurationError: 'ConfigurationError',
                NetworkError: 'NetworkError',
                BatchSubmissionError: 'BatchSubmissionError',
                BatchExpiredError: 'BatchExpiredError'
            }
        };

        mockNormalizationHelper = {
            normalizeGeminiResponse: sinon.stub().callsFake(function (response, model) {
                return {
                    provider: 'gemini',
                    model: model,
                    content: 'normalized content',
                    finishReason: 'stop'
                };
            })
        };

        geminiBatchService = proxyquire(
            '../../../../cartridge/scripts/services/llmGeminiBatchService',
            {
                'dw/svc/LocalServiceRegistry': {
                    createService: mockCreateService
                },
                'dw/system/Logger': {
                    getLogger: sinon.stub().returns(mockLogger)
                },
                '*/cartridge/scripts/helpers/llmErrorHelper': mockErrorHelper,
                '*/cartridge/scripts/helpers/llmNormalizationHelper': mockNormalizationHelper
            }
        );
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('submitBatch', function () {

        var testModel;
        var testItems;

        beforeEach(function () {
            testModel = 'gemini-1.5-pro';
            testItems = [
                { customId: 'req-1', payload: { contents: [{ parts: [{ text: 'Hello' }] }] } },
                { customId: 'req-2', payload: { contents: [{ parts: [{ text: 'World' }] }] } }
            ];

            mockCallResult.ok = true;
            mockCallResult.object = {
                name: 'batches/batch-abc123',
                state: 'JOB_STATE_PENDING',
                batchStats: {
                    requestCount: 2,
                    successfulRequestCount: 0,
                    failedRequestCount: 0,
                    pendingRequestCount: 2
                },
                createTime: '2026-03-01T00:00:00Z'
            };
        });

        it('should call createService with SERVICE_ID llm.gemini.batch', function () {
            geminiBatchService.submitBatch(testModel, testItems);

            expect(mockCreateService.calledOnce).to.equal(true);
            expect(mockCreateService.firstCall.args[0]).to.equal('llm.gemini.batch');
        });

        it('should build request body with batch.input_config.requests.requests structure', function () {
            geminiBatchService.submitBatch(testModel, testItems);

            // Invoke the createRequest callback to inspect the body
            var requestBody = capturedCallbacks.createRequest(mockSvc, {
                body: {
                    batch: {
                        input_config: {
                            requests: {
                                requests: [
                                    { request: testItems[0].payload, metadata: { key: 'req-1' } },
                                    { request: testItems[1].payload, metadata: { key: 'req-2' } }
                                ]
                            }
                        }
                    }
                },
                model: testModel
            });

            var parsed = JSON.parse(requestBody);
            var innerRequests = parsed.batch.input_config.requests.requests;
            expect(innerRequests).to.be.an('array').with.lengthOf(2);
            expect(innerRequests[0]).to.have.property('request');
            expect(innerRequests[0]).to.have.deep.property('metadata', { key: 'req-1' });
            expect(innerRequests[1]).to.have.deep.property('metadata', { key: 'req-2' });
        });

        it('should set URL to baseUrl + /v1beta/models/ + model + :batchGenerateContent', function () {
            geminiBatchService.submitBatch(testModel, testItems);

            capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });

            expect(mockSvc.setURL.calledOnce).to.equal(true);
            expect(mockSvc.setURL.firstCall.args[0]).to.equal(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:batchGenerateContent'
            );
        });

        it('should include X-Goog-Api-Key header', function () {
            geminiBatchService.submitBatch(testModel, testItems);

            capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });

            expect(mockSvc.addHeader.calledWith('X-Goog-Api-Key', 'test-api-key-123')).to.equal(true);
        });

        it('should return { batchId, status, requestCounts, createdAt }', function () {
            var result = geminiBatchService.submitBatch(testModel, testItems);

            expect(result).to.deep.equal({
                batchId: 'batches/batch-abc123',
                status: 'pending',
                requestCounts: {
                    total: 2,
                    completed: 0,
                    failed: 0
                },
                createdAt: '2026-03-01T00:00:00Z'
            });
        });

        it('should use DEFAULT_BASE_URL fallback https://generativelanguage.googleapis.com', function () {
            mockCredential.getURL.returns(null);

            geminiBatchService.submitBatch(testModel, testItems);

            capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });

            expect(mockSvc.setURL.firstCall.args[0]).to.include('https://generativelanguage.googleapis.com');
        });

        it('should use credential URL host when available instead of default', function () {
            mockCredential.getURL.returns('https://custom-gemini.example.com');

            geminiBatchService.submitBatch(testModel, testItems);

            capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });

            expect(mockSvc.setURL.firstCall.args[0]).to.equal(
                'https://custom-gemini.example.com/v1beta/models/gemini-1.5-pro:batchGenerateContent'
            );
        });

        it('should strip path segments from credential URL to avoid duplication', function () {
            // The sync credential URL includes /v1beta/models — batch must strip it
            mockCredential.getURL.returns('https://generativelanguage.googleapis.com/v1beta/models');

            geminiBatchService.submitBatch(testModel, testItems);

            capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });

            expect(mockSvc.setURL.firstCall.args[0]).to.equal(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:batchGenerateContent'
            );
        });

        it('should throw BatchSubmissionError on failure', function () {
            mockCallResult.ok = false;
            mockCallResult.errorMessage = 'Service call failed';
            mockCallResult.error = null;

            expect(function () {
                geminiBatchService.submitBatch(testModel, testItems);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('BatchSubmissionError');
        });

        it('should re-throw existing LLM errors from result.error', function () {
            var existingError = new Error('Existing LLM error');
            existingError.isLLMError = true;
            existingError.errorType = 'RateLimitError';

            mockCallResult.ok = false;
            mockCallResult.errorMessage = 'Rate limit';
            mockCallResult.error = existingError;

            expect(function () {
                geminiBatchService.submitBatch(testModel, testItems);
            }).to.throw('Existing LLM error');
        });

        it('should throw ConfigurationError when credential is missing', function () {
            mockSvc.getConfiguration.returns({
                getCredential: sinon.stub().returns(null)
            });

            geminiBatchService.submitBatch(testModel, testItems);

            expect(function () {
                capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('ConfigurationError');
        });

        it('should throw ConfigurationError when API key is missing', function () {
            mockCredential.getPassword.returns(null);

            geminiBatchService.submitBatch(testModel, testItems);

            expect(function () {
                capturedCallbacks.createRequest(mockSvc, { body: { requests: [] }, model: testModel });
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('ConfigurationError');
        });
    });

    describe('getBatchStatus', function () {

        var testBatchId;

        beforeEach(function () {
            testBatchId = 'batches/batch-abc123';
        });

        it('should map JOB_STATE_PENDING to pending', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_PENDING',
                batchStats: { requestCount: 5, successfulRequestCount: 0, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.status).to.equal('pending');
        });

        it('should map JOB_STATE_RUNNING to processing', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_RUNNING',
                batchStats: { requestCount: 5, successfulRequestCount: 2, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.status).to.equal('processing');
        });

        it('should map JOB_STATE_SUCCEEDED to completed', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 5, successfulRequestCount: 5, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.status).to.equal('completed');
        });

        it('should map JOB_STATE_FAILED to failed', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_FAILED',
                batchStats: { requestCount: 5, successfulRequestCount: 0, failedRequestCount: 5 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.status).to.equal('failed');
        });

        it('should map JOB_STATE_CANCELLED to cancelled', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_CANCELLED',
                batchStats: { requestCount: 5, successfulRequestCount: 0, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.status).to.equal('cancelled');
        });

        it('should map JOB_STATE_EXPIRED to expired', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_EXPIRED',
                batchStats: { requestCount: 5, successfulRequestCount: 0, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.status).to.equal('expired');
        });

        it('should set URL to baseUrl + /v1beta/ + batchId', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_RUNNING',
                batchStats: { requestCount: 5, successfulRequestCount: 0, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            geminiBatchService.getBatchStatus(testBatchId);

            capturedCallbacks.createRequest(mockSvc, { batchId: testBatchId });

            expect(mockSvc.setURL.calledOnce).to.equal(true);
            expect(mockSvc.setURL.firstCall.args[0]).to.equal(
                'https://generativelanguage.googleapis.com/v1beta/batches/batch-abc123'
            );
        });

        it('should strip path segments from credential URL to avoid duplication', function () {
            mockCredential.getURL.returns('https://generativelanguage.googleapis.com/v1beta/models');
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_RUNNING',
                batchStats: { requestCount: 5, successfulRequestCount: 0, failedRequestCount: 0 },
                createTime: '2026-03-01T00:00:00Z'
            };

            geminiBatchService.getBatchStatus(testBatchId);

            capturedCallbacks.createRequest(mockSvc, { batchId: testBatchId });

            expect(mockSvc.setURL.firstCall.args[0]).to.equal(
                'https://generativelanguage.googleapis.com/v1beta/batches/batch-abc123'
            );
        });

        it('should return requestCounts from batchStats', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 10, successfulRequestCount: 8, failedRequestCount: 2 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);

            expect(result.requestCounts).to.deep.equal({
                total: 10,
                completed: 8,
                failed: 2
            });
        });

        it('should return expiresAt as null', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_PENDING',
                batchStats: { requestCount: 1 },
                createTime: '2026-03-01T00:00:00Z'
            };

            var result = geminiBatchService.getBatchStatus(testBatchId);
            expect(result.expiresAt).to.be.null;
        });

        it('should throw ProviderError on failure', function () {
            mockCallResult.ok = false;
            mockCallResult.errorMessage = 'Status check failed';
            mockCallResult.error = null;

            expect(function () {
                geminiBatchService.getBatchStatus(testBatchId);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('ProviderError');
        });
    });

    describe('getBatchResults', function () {

        var testBatchId;
        var testModel;

        beforeEach(function () {
            testBatchId = 'batches/batch-abc123';
            testModel = 'gemini-1.5-pro';
        });

        it('should normalize successful inlinedResponses via normalizeGeminiResponse', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 1, successfulRequestCount: 1, failedRequestCount: 0 },
                response: {
                    inlinedResponses: [
                        {
                            metadata: { key: 'req-1' },
                            response: {
                                candidates: [{
                                    content: { parts: [{ text: 'Test response' }], role: 'model' },
                                    finishReason: 'STOP'
                                }],
                                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
                            }
                        }
                    ]
                }
            };

            var results = geminiBatchService.getBatchResults(testBatchId, testModel);

            expect(mockNormalizationHelper.normalizeGeminiResponse.calledOnce).to.equal(true);
            expect(mockNormalizationHelper.normalizeGeminiResponse.firstCall.args[1]).to.equal(testModel);
            expect(results).to.have.lengthOf(1);
            expect(results[0].success).to.equal(true);
            expect(results[0].response.provider).to.equal('gemini');
            expect(results[0].response.rawResponse).to.deep.equal(
                mockCallResult.object.response.inlinedResponses[0].response
            );
        });

        it('should map error items in inlinedResponses', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 1, successfulRequestCount: 0, failedRequestCount: 1 },
                response: {
                    inlinedResponses: [
                        {
                            metadata: { key: 'req-err' },
                            error: { code: 500, message: 'Internal error' }
                        }
                    ]
                }
            };

            var results = geminiBatchService.getBatchResults(testBatchId, testModel);

            expect(results).to.have.lengthOf(1);
            expect(results[0].success).to.equal(false);
            expect(results[0].customId).to.equal('req-err');
            expect(results[0].error).to.be.an.instanceof(Error);
            expect(results[0].error.errorType).to.equal('ProviderError');
        });

        it('should throw BatchSubmissionError when batch not in terminal state', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_RUNNING',
                batchStats: { requestCount: 5, successfulRequestCount: 2, failedRequestCount: 0 },
                response: { inlinedResponses: [] }
            };

            expect(function () {
                geminiBatchService.getBatchResults(testBatchId, testModel);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('BatchSubmissionError');
            expect(callArgs[0]).to.include('not yet complete');
        });

        it('should extract customId from metadata.key', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 2, successfulRequestCount: 2, failedRequestCount: 0 },
                response: {
                    inlinedResponses: [
                        {
                            metadata: { key: 'custom-id-abc' },
                            response: {
                                candidates: [{ content: { parts: [{ text: 'Resp 1' }], role: 'model' }, finishReason: 'STOP' }],
                                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 }
                            }
                        },
                        {
                            metadata: { key: 'custom-id-xyz' },
                            response: {
                                candidates: [{ content: { parts: [{ text: 'Resp 2' }], role: 'model' }, finishReason: 'STOP' }],
                                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 }
                            }
                        }
                    ]
                }
            };

            var results = geminiBatchService.getBatchResults(testBatchId, testModel);

            expect(results[0].customId).to.equal('custom-id-abc');
            expect(results[1].customId).to.equal('custom-id-xyz');
        });

        it('should default customId to unknown when metadata.key is missing', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 1, successfulRequestCount: 1, failedRequestCount: 0 },
                response: {
                    inlinedResponses: [
                        {
                            metadata: {},
                            response: {
                                candidates: [{ content: { parts: [{ text: 'Resp' }], role: 'model' }, finishReason: 'STOP' }],
                                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 }
                            }
                        }
                    ]
                }
            };

            var results = geminiBatchService.getBatchResults(testBatchId, testModel);

            expect(results[0].customId).to.equal('unknown');
        });

        it('should handle both success and error items in the same batch', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_SUCCEEDED',
                batchStats: { requestCount: 2, successfulRequestCount: 1, failedRequestCount: 1 },
                response: {
                    inlinedResponses: [
                        {
                            metadata: { key: 'r1' },
                            response: {
                                candidates: [{ content: { parts: [{ text: 'OK' }], role: 'model' }, finishReason: 'STOP' }],
                                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 }
                            }
                        },
                        {
                            metadata: { key: 'r2' },
                            error: { code: 500, message: 'Internal error' }
                        }
                    ]
                }
            };

            var results = geminiBatchService.getBatchResults(testBatchId, testModel);

            expect(results).to.have.lengthOf(2);
            expect(results[0].success).to.equal(true);
            expect(results[0].customId).to.equal('r1');
            expect(results[1].success).to.equal(false);
            expect(results[1].customId).to.equal('r2');
        });

        it('should allow getBatchResults when state is JOB_STATE_FAILED', function () {
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_FAILED',
                batchStats: { requestCount: 1, successfulRequestCount: 0, failedRequestCount: 1 },
                response: {
                    inlinedResponses: [
                        {
                            metadata: { key: 'r1' },
                            error: { code: 500, message: 'Failed' }
                        }
                    ]
                }
            };

            var results = geminiBatchService.getBatchResults(testBatchId, testModel);

            expect(results).to.have.lengthOf(1);
            expect(results[0].success).to.equal(false);
        });

        it('should throw ProviderError when service call fails', function () {
            mockCallResult.ok = false;
            mockCallResult.errorMessage = 'Results retrieval failed';
            mockCallResult.error = null;

            expect(function () {
                geminiBatchService.getBatchResults(testBatchId, testModel);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('ProviderError');
        });
    });

    describe('cancelBatch', function () {

        var testBatchId;

        beforeEach(function () {
            testBatchId = 'batches/batch-abc123';

            mockCallResult.ok = true;
            mockCallResult.object = {
                name: testBatchId,
                state: 'JOB_STATE_CANCELLED'
            };
        });

        it('should return { batchId, status: cancelling }', function () {
            var result = geminiBatchService.cancelBatch(testBatchId);

            expect(result).to.deep.equal({
                batchId: 'batches/batch-abc123',
                status: 'cancelling'
            });
        });

        it('should set URL to baseUrl + /v1beta/ + batchId + :cancel', function () {
            geminiBatchService.cancelBatch(testBatchId);

            capturedCallbacks.createRequest(mockSvc, { batchId: testBatchId });

            expect(mockSvc.setURL.calledOnce).to.equal(true);
            expect(mockSvc.setURL.firstCall.args[0]).to.equal(
                'https://generativelanguage.googleapis.com/v1beta/batches/batch-abc123:cancel'
            );
        });

        it('should use POST method', function () {
            geminiBatchService.cancelBatch(testBatchId);

            capturedCallbacks.createRequest(mockSvc, { batchId: testBatchId });

            expect(mockSvc.setRequestMethod.calledWith('POST')).to.equal(true);
        });

        it('should include X-Goog-Api-Key header', function () {
            geminiBatchService.cancelBatch(testBatchId);

            capturedCallbacks.createRequest(mockSvc, { batchId: testBatchId });

            expect(mockSvc.addHeader.calledWith('X-Goog-Api-Key', 'test-api-key-123')).to.equal(true);
        });

        it('should throw ProviderError on failure', function () {
            mockCallResult.ok = false;
            mockCallResult.errorMessage = 'Cancellation failed';
            mockCallResult.error = null;

            expect(function () {
                geminiBatchService.cancelBatch(testBatchId);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.equal(true);
            var callArgs = mockErrorHelper.createLLMError.lastCall.args;
            expect(callArgs[1]).to.equal('ProviderError');
        });

        it('should re-throw existing LLM errors from result.error', function () {
            var existingError = new Error('Existing cancel error');
            existingError.isLLMError = true;
            existingError.errorType = 'ProviderError';

            mockCallResult.ok = false;
            mockCallResult.errorMessage = 'Cancel failed';
            mockCallResult.error = existingError;

            expect(function () {
                geminiBatchService.cancelBatch(testBatchId);
            }).to.throw('Existing cancel error');
        });
    });

    describe('SERVICE_ID', function () {

        it('should equal llm.gemini.batch', function () {
            expect(geminiBatchService.SERVICE_ID).to.equal('llm.gemini.batch');
        });
    });

    describe('parseResponse callbacks', function () {

        it('should parse JSON response on 200 status for submitBatch', function () {
            var responseObj = { name: 'batches/test', state: 'JOB_STATE_PENDING' };

            mockCallResult.object = responseObj;
            geminiBatchService.submitBatch('gemini-1.5-pro', [{ customId: 'r1', payload: {} }]);

            var mockClient = {
                statusCode: 200,
                text: JSON.stringify(responseObj)
            };

            var parsed = capturedCallbacks.parseResponse(mockSvc, mockClient);
            expect(parsed).to.deep.equal(responseObj);
        });

        it('should throw mapped provider error on non-200 status', function () {
            mockCallResult.object = { name: 'batches/test', state: 'JOB_STATE_PENDING' };
            geminiBatchService.submitBatch('gemini-1.5-pro', [{ customId: 'r1', payload: {} }]);

            var mockClient = {
                statusCode: 400,
                text: JSON.stringify({ error: { message: 'Bad request' } })
            };

            expect(function () {
                capturedCallbacks.parseResponse(mockSvc, mockClient);
            }).to.throw(Error);

            expect(mockErrorHelper.mapProviderError.calledWith('gemini', 400)).to.equal(true);
        });

        it('should handle non-JSON error response body', function () {
            mockCallResult.object = { name: 'batches/test', state: 'JOB_STATE_PENDING' };
            geminiBatchService.submitBatch('gemini-1.5-pro', [{ customId: 'r1', payload: {} }]);

            var mockClient = {
                statusCode: 500,
                text: 'Internal Server Error'
            };

            expect(function () {
                capturedCallbacks.parseResponse(mockSvc, mockClient);
            }).to.throw(Error);

            expect(mockErrorHelper.mapProviderError.called).to.equal(true);
            var errorBody = mockErrorHelper.mapProviderError.lastCall.args[2];
            expect(errorBody).to.deep.equal({ message: 'Internal Server Error' });
        });
    });

    describe('filterLogMessage callbacks', function () {

        it('should delegate to sanitizeForLogging', function () {
            mockCallResult.object = { name: 'batches/test', state: 'JOB_STATE_PENDING' };
            geminiBatchService.submitBatch('gemini-1.5-pro', [{ customId: 'r1', payload: {} }]);

            var result = capturedCallbacks.filterLogMessage('X-Goog-Api-Key: secret123');

            expect(mockErrorHelper.sanitizeForLogging.calledWith('X-Goog-Api-Key: secret123')).to.equal(true);
            expect(result).to.equal('X-Goog-Api-Key: secret123');
        });
    });
});
