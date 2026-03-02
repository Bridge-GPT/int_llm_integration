'use strict';

var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();
var expect = chai.expect;

describe('llmAnthropicBatchService', function () {

    var batchService;
    var mockCreateService;
    var mockLogger;
    var mockErrorHelper;
    var mockNormalizationHelper;
    var mockConfigHelper;

    // Captures the service definition callbacks passed to createService
    var capturedServiceDef;
    // The mock service object returned by createService
    var mockServiceInstance;
    // The mock svc object passed to createRequest
    var mockSvc;

    beforeEach(function () {
        capturedServiceDef = null;
        mockServiceInstance = {
            call: sinon.stub()
        };

        mockCreateService = sinon.stub().callsFake(function (serviceId, serviceDef) {
            capturedServiceDef = serviceDef;
            return mockServiceInstance;
        });

        mockLogger = {
            getLogger: sinon.stub().returns({
                info: sinon.stub(),
                error: sinon.stub(),
                warn: sinon.stub(),
                debug: sinon.stub()
            })
        };

        mockErrorHelper = {
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
            },
            createLLMError: sinon.stub().callsFake(function (message, errorType, status, providerError) {
                var error = new Error(message);
                error.errorType = errorType;
                error.status = status;
                error.providerError = providerError;
                error.isLLMError = true;
                return error;
            }),
            mapProviderError: sinon.stub().callsFake(function (provider, statusCode, errorBody) {
                var error = new Error(provider + ' error: ' + statusCode);
                error.errorType = 'ProviderError';
                error.status = statusCode;
                error.providerError = errorBody;
                error.isLLMError = true;
                return error;
            }),
            sanitizeForLogging: sinon.stub().callsFake(function (msg) {
                return msg;
            })
        };

        mockNormalizationHelper = {
            normalizeAnthropicResponse: sinon.stub().callsFake(function (message, model) {
                return {
                    text: 'normalized-text',
                    model: model,
                    usage: { inputTokens: 10, outputTokens: 5 }
                };
            })
        };

        mockConfigHelper = {
            getAnthropicApiVersion: sinon.stub().returns('2024-01-01')
        };

        mockSvc = {
            setURL: sinon.stub(),
            setRequestMethod: sinon.stub(),
            addHeader: sinon.stub(),
            getConfiguration: sinon.stub().returns({
                getCredential: sinon.stub().returns({
                    getPassword: sinon.stub().returns('test-api-key'),
                    getURL: sinon.stub().returns('https://api.anthropic.com')
                })
            })
        };

        batchService = proxyquire('../../../../cartridge/scripts/services/llmAnthropicBatchService', {
            'dw/svc/LocalServiceRegistry': { createService: mockCreateService },
            'dw/system/Logger': mockLogger,
            '*/cartridge/scripts/helpers/llmErrorHelper': mockErrorHelper,
            '*/cartridge/scripts/helpers/llmNormalizationHelper': mockNormalizationHelper,
            '*/cartridge/scripts/helpers/llmConfigHelper': mockConfigHelper
        });
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('SERVICE_ID', function () {
        it('should equal \'llm.anthropic.batch\'', function () {
            expect(batchService.SERVICE_ID).to.equal('llm.anthropic.batch');
        });
    });

    describe('submitBatch', function () {
        var model = 'claude-3-5-sonnet-20241022';
        var items = [
            { customId: 'req-1', payload: { model: model, max_tokens: 1024, messages: [{ role: 'user', content: 'Hello' }] } },
            { customId: 'req-2', payload: { model: model, max_tokens: 1024, messages: [{ role: 'user', content: 'World' }] } }
        ];

        it('should call createService with SERVICE_ID \'llm.anthropic.batch\'', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: 'msgbatch_123',
                    processing_status: 'in_progress',
                    request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
                    created_at: '2024-01-01T00:00:00Z',
                    expires_at: '2024-01-02T00:00:00Z'
                }
            });

            batchService.submitBatch(model, items);

            expect(mockCreateService.calledOnce).to.be.true;
            expect(mockCreateService.firstCall.args[0]).to.equal('llm.anthropic.batch');
        });

        it('should build request body with { requests: [{ custom_id, params }] } structure', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: 'msgbatch_123',
                    processing_status: 'in_progress',
                    request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
                    created_at: '2024-01-01T00:00:00Z',
                    expires_at: '2024-01-02T00:00:00Z'
                }
            });

            batchService.submitBatch(model, items);

            // Execute createRequest to inspect the body
            var params = { body: { requests: [{ custom_id: 'req-1', params: items[0].payload }, { custom_id: 'req-2', params: items[1].payload }] }, apiVersion: '2024-01-01' };
            var requestBody = capturedServiceDef.createRequest(mockSvc, params);
            var parsed = JSON.parse(requestBody);

            expect(parsed.requests).to.be.an('array').with.lengthOf(2);
            expect(parsed.requests[0].custom_id).to.equal('req-1');
            expect(parsed.requests[0].params).to.deep.equal(items[0].payload);
            expect(parsed.requests[1].custom_id).to.equal('req-2');
            expect(parsed.requests[1].params).to.deep.equal(items[1].payload);
        });

        it('should include x-api-key and anthropic-version headers', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: 'msgbatch_123',
                    processing_status: 'in_progress',
                    request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
                    created_at: '2024-01-01T00:00:00Z',
                    expires_at: '2024-01-02T00:00:00Z'
                }
            });

            batchService.submitBatch(model, items);

            var params = { body: { requests: [] }, apiVersion: '2024-01-01' };
            capturedServiceDef.createRequest(mockSvc, params);

            expect(mockSvc.addHeader.calledWith('x-api-key', 'test-api-key')).to.be.true;
            expect(mockSvc.addHeader.calledWith('anthropic-version', '2024-01-01')).to.be.true;
            expect(mockSvc.addHeader.calledWith('Content-Type', 'application/json')).to.be.true;
        });

        it('should return { batchId, status, requestCounts, createdAt, expiresAt }', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: 'msgbatch_abc',
                    processing_status: 'in_progress',
                    request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
                    created_at: '2024-01-01T00:00:00Z',
                    expires_at: '2024-01-02T00:00:00Z'
                }
            });

            var result = batchService.submitBatch(model, items);

            expect(result).to.deep.equal({
                batchId: 'msgbatch_abc',
                status: 'in_progress',
                requestCounts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
                createdAt: '2024-01-01T00:00:00Z',
                expiresAt: '2024-01-02T00:00:00Z'
            });
        });

        it('should throw BatchSubmissionError on service failure', function () {
            mockServiceInstance.call.returns({
                ok: false,
                errorMessage: 'Service call failed'
            });

            expect(function () {
                batchService.submitBatch(model, items);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.be.true;
            var createCall = mockErrorHelper.createLLMError.lastCall;
            expect(createCall.args[1]).to.equal('BatchSubmissionError');
        });

        it('should throw ConfigurationError when credential is missing', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: { id: 'test', processing_status: 'in_progress', request_counts: {}, created_at: '', expires_at: '' }
            });

            batchService.submitBatch(model, items);

            // Now invoke createRequest with a svc that has no credential
            var svcNoCredential = {
                setURL: sinon.stub(),
                setRequestMethod: sinon.stub(),
                addHeader: sinon.stub(),
                getConfiguration: sinon.stub().returns({
                    getCredential: sinon.stub().returns(null)
                })
            };

            expect(function () {
                capturedServiceDef.createRequest(svcNoCredential, { body: {}, apiVersion: '2024-01-01' });
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.be.true;
            var createCall = mockErrorHelper.createLLMError.lastCall;
            expect(createCall.args[1]).to.equal('ConfigurationError');
        });

        it('should use fallback base URL \'https://api.anthropic.com\'', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: { id: 'test', processing_status: 'in_progress', request_counts: {}, created_at: '', expires_at: '' }
            });

            batchService.submitBatch(model, items);

            // Invoke createRequest with a credential that returns empty URL
            var svcEmptyUrl = {
                setURL: sinon.stub(),
                setRequestMethod: sinon.stub(),
                addHeader: sinon.stub(),
                getConfiguration: sinon.stub().returns({
                    getCredential: sinon.stub().returns({
                        getPassword: sinon.stub().returns('test-api-key'),
                        getURL: sinon.stub().returns('')
                    })
                })
            };

            capturedServiceDef.createRequest(svcEmptyUrl, { body: {}, apiVersion: '2024-01-01' });

            expect(svcEmptyUrl.setURL.calledWith('https://api.anthropic.com/v1/messages/batches')).to.be.true;
        });
    });

    describe('getBatchStatus', function () {
        var batchId = 'msgbatch_status_test';

        function callGetBatchStatusWith(processingStatus, counts) {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: batchId,
                    processing_status: processingStatus,
                    request_counts: counts,
                    created_at: '2024-01-01T00:00:00Z',
                    expires_at: '2024-01-02T00:00:00Z'
                }
            });

            return batchService.getBatchStatus(batchId);
        }

        it('should map \'in_progress\' to \'processing\'', function () {
            var result = callGetBatchStatusWith('in_progress', {
                processing: 5, succeeded: 0, errored: 0, canceled: 0, expired: 0
            });

            expect(result.status).to.equal('processing');
        });

        it('should map \'canceling\' to \'cancelling\'', function () {
            var result = callGetBatchStatusWith('canceling', {
                processing: 3, succeeded: 2, errored: 0, canceled: 0, expired: 0
            });

            expect(result.status).to.equal('cancelling');
        });

        it('should map \'ended\' with succeeded > 0 to \'completed\'', function () {
            var result = callGetBatchStatusWith('ended', {
                processing: 0, succeeded: 5, errored: 0, canceled: 0, expired: 0
            });

            expect(result.status).to.equal('completed');
        });

        it('should map \'ended\' with succeeded=0 and errored>0 to \'failed\'', function () {
            var result = callGetBatchStatusWith('ended', {
                processing: 0, succeeded: 0, errored: 3, canceled: 0, expired: 0
            });

            expect(result.status).to.equal('failed');
        });

        it('should calculate total from all count fields', function () {
            var result = callGetBatchStatusWith('ended', {
                processing: 1, succeeded: 3, errored: 2, canceled: 1, expired: 1
            });

            expect(result.requestCounts.total).to.equal(8);
            expect(result.requestCounts.completed).to.equal(3);
            expect(result.requestCounts.failed).to.equal(2);
        });

        it('should return correct shape', function () {
            var result = callGetBatchStatusWith('in_progress', {
                processing: 10, succeeded: 0, errored: 0, canceled: 0, expired: 0
            });

            expect(result).to.have.all.keys('batchId', 'status', 'requestCounts', 'createdAt', 'expiresAt');
            expect(result.batchId).to.equal(batchId);
            expect(result.requestCounts).to.have.all.keys('total', 'completed', 'failed');
            expect(result.createdAt).to.be.a('string');
        });
    });

    describe('getBatchResults', function () {
        var batchId = 'msgbatch_results_test';
        var model = 'claude-3-5-sonnet-20241022';

        it('should normalize succeeded items via normalizeAnthropicResponse', function () {
            var succeededLine = JSON.stringify({
                custom_id: 'req-1',
                result: {
                    type: 'succeeded',
                    message: {
                        id: 'msg_001',
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Response text' }],
                        stop_reason: 'end_turn',
                        usage: { input_tokens: 10, output_tokens: 5 }
                    }
                }
            });

            mockServiceInstance.call.returns({
                ok: true,
                object: succeededLine
            });

            var results = batchService.getBatchResults(batchId, model);

            expect(results).to.have.lengthOf(1);
            expect(results[0].customId).to.equal('req-1');
            expect(results[0].success).to.be.true;
            expect(results[0].response).to.exist;
            expect(results[0].response.text).to.equal('normalized-text');
            expect(results[0].response.rawResponse).to.exist;
            expect(mockNormalizationHelper.normalizeAnthropicResponse.calledOnce).to.be.true;
            expect(mockNormalizationHelper.normalizeAnthropicResponse.firstCall.args[1]).to.equal(model);
        });

        it('should map errored items to error objects', function () {
            var erroredLine = JSON.stringify({
                custom_id: 'req-2',
                result: {
                    type: 'errored',
                    error: { type: 'server_error', message: 'Internal error' }
                }
            });

            mockServiceInstance.call.returns({
                ok: true,
                object: erroredLine
            });

            var results = batchService.getBatchResults(batchId, model);

            expect(results).to.have.lengthOf(1);
            expect(results[0].customId).to.equal('req-2');
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.exist;
            expect(results[0].error.isLLMError).to.be.true;
            expect(results[0].error.errorType).to.equal('ProviderError');
            expect(results[0].error.message).to.include('Internal error');
        });

        it('should map expired items with BatchExpiredError', function () {
            var expiredLine = JSON.stringify({
                custom_id: 'req-3',
                result: {
                    type: 'expired'
                }
            });

            mockServiceInstance.call.returns({
                ok: true,
                object: expiredLine
            });

            var results = batchService.getBatchResults(batchId, model);

            expect(results).to.have.lengthOf(1);
            expect(results[0].customId).to.equal('req-3');
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.exist;
            expect(results[0].error.errorType).to.equal('BatchExpiredError');
        });

        it('should map canceled items to error objects', function () {
            var canceledLine = JSON.stringify({
                custom_id: 'req-4',
                result: {
                    type: 'canceled'
                }
            });

            mockServiceInstance.call.returns({
                ok: true,
                object: canceledLine
            });

            var results = batchService.getBatchResults(batchId, model);

            expect(results).to.have.lengthOf(1);
            expect(results[0].customId).to.equal('req-4');
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.exist;
            expect(results[0].error.errorType).to.equal('ProviderError');
            expect(results[0].error.message).to.include('canceled');
        });

        it('should handle parseError lines', function () {
            var malformedJsonl = 'not valid json at all';

            mockServiceInstance.call.returns({
                ok: true,
                object: malformedJsonl
            });

            var results = batchService.getBatchResults(batchId, model);

            expect(results).to.have.lengthOf(1);
            expect(results[0].customId).to.equal('unknown');
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.exist;
            expect(results[0].error.errorType).to.equal('ProviderError');
            expect(results[0].error.message).to.include('Failed to parse result line');
        });
    });

    describe('cancelBatch', function () {
        var batchId = 'msgbatch_cancel_test';

        it('should return { batchId, status: \'cancelling\' }', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: batchId,
                    type: 'message_batch',
                    processing_status: 'canceling'
                }
            });

            var result = batchService.cancelBatch(batchId);

            expect(result).to.deep.equal({
                batchId: batchId,
                status: 'cancelling'
            });
        });

        it('should include correct headers', function () {
            mockServiceInstance.call.returns({
                ok: true,
                object: {
                    id: batchId,
                    type: 'message_batch',
                    processing_status: 'canceling'
                }
            });

            batchService.cancelBatch(batchId);

            // Invoke createRequest to verify headers
            capturedServiceDef.createRequest(mockSvc, { batchId: batchId, apiVersion: '2024-01-01' });

            expect(mockSvc.addHeader.calledWith('x-api-key', 'test-api-key')).to.be.true;
            expect(mockSvc.addHeader.calledWith('anthropic-version', '2024-01-01')).to.be.true;
            expect(mockSvc.setRequestMethod.calledWith('POST')).to.be.true;
            expect(mockSvc.setURL.firstCall.args[0]).to.include('/v1/messages/batches/' + batchId + '/cancel');
        });

        it('should throw ProviderError on failure', function () {
            mockServiceInstance.call.returns({
                ok: false,
                errorMessage: 'Cancel failed'
            });

            expect(function () {
                batchService.cancelBatch(batchId);
            }).to.throw(Error);

            expect(mockErrorHelper.createLLMError.called).to.be.true;
            var createCall = mockErrorHelper.createLLMError.lastCall;
            expect(createCall.args[1]).to.equal('ProviderError');
        });
    });
});
