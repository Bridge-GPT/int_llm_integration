'use strict';

var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();
var expect = chai.expect;

describe('llmOpenAIBatchService', function () {

    var batchService;
    var createServiceStub;
    var serviceCallStub;
    var createServiceCalls;
    var mockErrorHelper;
    var mockNormalizationHelper;
    var mockLogger;
    var mockSvc;
    var mockCredential;

    beforeEach(function () {
        createServiceCalls = [];
        serviceCallStub = sinon.stub();

        createServiceStub = sinon.stub().callsFake(function (serviceId, callbacks) {
            createServiceCalls.push({ serviceId: serviceId, callbacks: callbacks });
            return { call: serviceCallStub };
        });

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
            createLLMError: function (message, errorType, status, providerError) {
                var error = new Error(message);
                error.errorType = errorType;
                error.status = status;
                error.providerError = providerError;
                error.isLLMError = true;
                return error;
            },
            mapProviderError: function (provider, statusCode, body) {
                var error = new Error(provider + ' error: ' + statusCode);
                error.errorType = 'ProviderError';
                error.status = statusCode;
                error.providerError = body;
                error.isLLMError = true;
                return error;
            },
            sanitizeForLogging: sinon.stub().callsFake(function (msg) {
                return msg;
            })
        };

        mockNormalizationHelper = {
            normalizeOpenAIResponse: sinon.stub().callsFake(function (body, model) {
                return { content: body.choices[0].message.content, model: model };
            })
        };

        mockLogger = {
            getLogger: sinon.stub().returns({
                error: sinon.stub(),
                warn: sinon.stub(),
                info: sinon.stub(),
                debug: sinon.stub()
            })
        };

        mockCredential = {
            getPassword: sinon.stub().returns('sk-test-key-123'),
            getURL: sinon.stub().returns('https://api.openai.com')
        };

        mockSvc = {
            setURL: sinon.stub(),
            setRequestMethod: sinon.stub(),
            addHeader: sinon.stub(),
            getConfiguration: sinon.stub().returns({
                getCredential: sinon.stub().returns(mockCredential)
            })
        };

        batchService = proxyquire('../../../../cartridge/scripts/services/llmOpenAIBatchService', {
            'dw/svc/LocalServiceRegistry': { createService: createServiceStub },
            'dw/system/Logger': mockLogger,
            '*/cartridge/scripts/helpers/llmErrorHelper': mockErrorHelper,
            '*/cartridge/scripts/helpers/llmNormalizationHelper': mockNormalizationHelper
        });
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('SERVICE_ID', function () {

        it('should equal llm.openai.batch', function () {
            expect(batchService.SERVICE_ID).to.equal('llm.openai.batch');
        });
    });

    describe('submitBatch', function () {

        var mockItems;
        var mockUploadResponse;
        var mockBatchResponse;

        beforeEach(function () {
            mockItems = [
                { customId: 'req-1', payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] } },
                { customId: 'req-2', payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'World' }] } }
            ];

            mockUploadResponse = {
                ok: true,
                object: { id: 'file-abc123', object: 'file', purpose: 'batch' }
            };

            mockBatchResponse = {
                ok: true,
                object: {
                    id: 'batch_xyz789',
                    status: 'validating',
                    request_counts: { total: 2, completed: 0, failed: 0 },
                    created_at: 1700000000
                }
            };

            serviceCallStub.onFirstCall().returns(mockUploadResponse);
            serviceCallStub.onSecondCall().returns(mockBatchResponse);
        });

        it('should call createService twice with SERVICE_ID llm.openai.batch', function () {
            batchService.submitBatch('gpt-4', mockItems);

            expect(createServiceStub.calledTwice).to.be.true;
            expect(createServiceCalls[0].serviceId).to.equal('llm.openai.batch');
            expect(createServiceCalls[1].serviceId).to.equal('llm.openai.batch');
        });

        it('should construct JSONL lines with correct format', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var callArgs = serviceCallStub.firstCall.args[0];
            var bodyString = callArgs.body;

            var jsonlSection = bodyString.split('application/jsonl\r\n\r\n')[1].split('\r\n--')[0];
            var lines = jsonlSection.split('\n');

            expect(lines).to.have.lengthOf(2);

            var line1 = JSON.parse(lines[0]);
            expect(line1.custom_id).to.equal('req-1');
            expect(line1.method).to.equal('POST');
            expect(line1.url).to.equal('/v1/chat/completions');
            expect(line1.body).to.deep.equal(mockItems[0].payload);

            var line2 = JSON.parse(lines[1]);
            expect(line2.custom_id).to.equal('req-2');
            expect(line2.method).to.equal('POST');
            expect(line2.url).to.equal('/v1/chat/completions');
            expect(line2.body).to.deep.equal(mockItems[1].payload);
        });

        it('should set URL to baseUrl + /v1/files with multipart content-type in first createRequest', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var createRequestFn = createServiceCalls[0].callbacks.createRequest;
            var params = { body: 'test-body', boundary: 'test-boundary' };
            createRequestFn(mockSvc, params);

            expect(mockSvc.setURL.calledWith('https://api.openai.com/v1/files')).to.be.true;
            expect(mockSvc.setRequestMethod.calledWith('POST')).to.be.true;
            expect(mockSvc.addHeader.calledWith('Content-Type', 'multipart/form-data; boundary=test-boundary')).to.be.true;
            expect(mockSvc.addHeader.calledWith('Authorization', 'Bearer sk-test-key-123')).to.be.true;
        });

        it('should set URL to baseUrl + /v1/batches with JSON content-type in second createRequest', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var createRequestFn = createServiceCalls[1].callbacks.createRequest;
            var params = { fileId: 'file-abc123', totalRequests: 2 };
            createRequestFn(mockSvc, params);

            expect(mockSvc.setURL.calledWith('https://api.openai.com/v1/batches')).to.be.true;
            expect(mockSvc.setRequestMethod.calledWith('POST')).to.be.true;
            expect(mockSvc.addHeader.calledWith('Content-Type', 'application/json')).to.be.true;
            expect(mockSvc.addHeader.calledWith('Authorization', 'Bearer sk-test-key-123')).to.be.true;
        });

        it('should use fallback base URL when credential URL is null', function () {
            mockCredential.getURL.returns(null);

            batchService.submitBatch('gpt-4', mockItems);

            var createRequestFn = createServiceCalls[0].callbacks.createRequest;
            createRequestFn(mockSvc, { body: 'test', boundary: 'b' });

            expect(mockSvc.setURL.calledWith('https://api.openai.com/v1/files')).to.be.true;
        });

        it('should return correct shape with batchId, status, requestCounts, createdAt', function () {
            var result = batchService.submitBatch('gpt-4', mockItems);

            expect(result).to.deep.equal({
                batchId: 'batch_xyz789',
                status: 'validating',
                requestCounts: { total: 2, completed: 0, failed: 0 },
                createdAt: 1700000000
            });
        });

        it('should throw BatchSubmissionError when file upload fails', function () {
            serviceCallStub.onFirstCall().returns({
                ok: false,
                errorMessage: 'Upload timeout'
            });

            expect(function () {
                batchService.submitBatch('gpt-4', mockItems);
            }).to.throw(/OpenAI batch file upload failed/);
        });

        it('should throw BatchSubmissionError when batch creation fails', function () {
            serviceCallStub.onSecondCall().returns({
                ok: false,
                errorMessage: 'Batch creation error'
            });

            expect(function () {
                batchService.submitBatch('gpt-4', mockItems);
            }).to.throw(/OpenAI batch creation failed/);
        });

        it('should re-throw errors that already have isLLMError flag on upload failure', function () {
            var existingError = new Error('Pre-existing LLM error');
            existingError.isLLMError = true;
            existingError.errorType = 'RateLimitError';

            serviceCallStub.onFirstCall().returns({
                ok: false,
                errorMessage: 'rate limited',
                error: existingError
            });

            expect(function () {
                batchService.submitBatch('gpt-4', mockItems);
            }).to.throw('Pre-existing LLM error');
        });

        it('should throw ConfigurationError when credential is missing', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var createRequestFn = createServiceCalls[0].callbacks.createRequest;
            var svcNoCredential = {
                setURL: sinon.stub(),
                setRequestMethod: sinon.stub(),
                addHeader: sinon.stub(),
                getConfiguration: sinon.stub().returns({
                    getCredential: sinon.stub().returns(null)
                })
            };

            expect(function () {
                createRequestFn(svcNoCredential, { body: 'test', boundary: 'b' });
            }).to.throw(/Service credential not configured/);
        });

        it('should throw ConfigurationError when API key is missing', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var createRequestFn = createServiceCalls[0].callbacks.createRequest;
            var credentialNoKey = {
                getPassword: sinon.stub().returns(null),
                getURL: sinon.stub().returns('https://api.openai.com')
            };
            var svcNoKey = {
                setURL: sinon.stub(),
                setRequestMethod: sinon.stub(),
                addHeader: sinon.stub(),
                getConfiguration: sinon.stub().returns({
                    getCredential: sinon.stub().returns(credentialNoKey)
                })
            };

            expect(function () {
                createRequestFn(svcNoKey, { body: 'test', boundary: 'b' });
            }).to.throw(/OpenAI API key not configured/);
        });

        it('should use \\r\\n line endings in multipart body', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var callArgs = serviceCallStub.firstCall.args[0];
            var bodyString = callArgs.body;

            expect(bodyString).to.contain('\r\n');
            expect(bodyString).to.contain('Content-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n');
            expect(bodyString).to.contain('Content-Disposition: form-data; name="file"; filename="batch.jsonl"\r\n');
            expect(bodyString).to.contain('Content-Type: application/jsonl\r\n\r\n');
        });

        it('should throw on non-200 status in parseResponse', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var parseResponseFn = createServiceCalls[0].callbacks.parseResponse;
            var mockClient = {
                statusCode: 400,
                text: JSON.stringify({ error: { message: 'Bad request' } })
            };

            expect(function () {
                parseResponseFn(mockSvc, mockClient);
            }).to.throw();
        });

        it('should return parsed JSON on 200 status in parseResponse', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var parseResponseFn = createServiceCalls[0].callbacks.parseResponse;
            var responseData = { id: 'file-123', object: 'file' };
            var mockClient = {
                statusCode: 200,
                text: JSON.stringify(responseData)
            };

            var result = parseResponseFn(mockSvc, mockClient);
            expect(result).to.deep.equal(responseData);
        });

        it('should delegate to errorHelper.sanitizeForLogging in filterLogMessage', function () {
            batchService.submitBatch('gpt-4', mockItems);

            var filterFn = createServiceCalls[0].callbacks.filterLogMessage;
            filterFn('some log message with sk-key123');

            expect(mockErrorHelper.sanitizeForLogging.calledWith('some log message with sk-key123')).to.be.true;
        });
    });

    describe('getBatchStatus', function () {

        var statusTests = [
            { openaiStatus: 'validating', expected: 'pending' },
            { openaiStatus: 'in_progress', expected: 'processing' },
            { openaiStatus: 'finalizing', expected: 'processing' },
            { openaiStatus: 'completed', expected: 'completed' },
            { openaiStatus: 'failed', expected: 'failed' },
            { openaiStatus: 'expired', expected: 'expired' },
            { openaiStatus: 'cancelling', expected: 'cancelling' },
            { openaiStatus: 'cancelled', expected: 'cancelled' }
        ];

        statusTests.forEach(function (test) {
            it('should map "' + test.openaiStatus + '" to "' + test.expected + '"', function () {
                serviceCallStub.returns({
                    ok: true,
                    object: {
                        id: 'batch_123',
                        status: test.openaiStatus,
                        request_counts: { total: 5, completed: 3, failed: 0 },
                        created_at: 1700000000,
                        expires_at: 1700086400,
                        output_file_id: null
                    }
                });

                var result = batchService.getBatchStatus('batch_123');
                expect(result.status).to.equal(test.expected);
            });
        });

        it('should return correct shape with outputFileId', function () {
            serviceCallStub.returns({
                ok: true,
                object: {
                    id: 'batch_456',
                    status: 'completed',
                    request_counts: { total: 10, completed: 9, failed: 1 },
                    created_at: 1700000000,
                    expires_at: 1700086400,
                    output_file_id: 'file-output-789'
                }
            });

            var result = batchService.getBatchStatus('batch_456');

            expect(result).to.deep.equal({
                batchId: 'batch_456',
                status: 'completed',
                requestCounts: { total: 10, completed: 9, failed: 1 },
                createdAt: 1700000000,
                expiresAt: 1700086400,
                outputFileId: 'file-output-789'
            });
        });

        it('should throw ProviderError on service failure', function () {
            serviceCallStub.returns({
                ok: false,
                errorMessage: 'Service unavailable'
            });

            expect(function () {
                batchService.getBatchStatus('batch_123');
            }).to.throw(/OpenAI batch status check failed/);
        });
    });

    describe('getBatchResults', function () {

        var successLine;
        var errorLine;

        beforeEach(function () {
            successLine = JSON.stringify({
                custom_id: 'req-1',
                response: {
                    status_code: 200,
                    body: {
                        id: 'chatcmpl-abc',
                        choices: [{ message: { content: 'Hello back!' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                    }
                }
            });

            errorLine = JSON.stringify({
                custom_id: 'req-2',
                response: {
                    status_code: 429,
                    body: { error: { message: 'Rate limited' } }
                }
            });

            // First call: getBatchStatus (internally called by getBatchResults)
            serviceCallStub.onFirstCall().returns({
                ok: true,
                object: {
                    id: 'batch_done',
                    status: 'completed',
                    request_counts: { total: 2, completed: 2, failed: 0 },
                    created_at: 1700000000,
                    expires_at: 1700086400,
                    output_file_id: 'file-output-abc'
                }
            });

            // Second call: file content download
            serviceCallStub.onSecondCall().returns({
                ok: true,
                object: successLine + '\n' + errorLine
            });
        });

        it('should normalize successful result lines via normalizeOpenAIResponse', function () {
            var results = batchService.getBatchResults('batch_done', 'gpt-4');

            expect(results[0].customId).to.equal('req-1');
            expect(results[0].success).to.be.true;
            expect(mockNormalizationHelper.normalizeOpenAIResponse.calledOnce).to.be.true;

            var normalizeCallArgs = mockNormalizationHelper.normalizeOpenAIResponse.firstCall.args;
            expect(normalizeCallArgs[1]).to.equal('gpt-4');
            expect(normalizeCallArgs[0].choices[0].message.content).to.equal('Hello back!');
        });

        it('should map error result lines to error objects', function () {
            var results = batchService.getBatchResults('batch_done', 'gpt-4');

            expect(results[1].customId).to.equal('req-2');
            expect(results[1].success).to.be.false;
            expect(results[1].error).to.be.an.instanceof(Error);
            expect(results[1].error.isLLMError).to.be.true;
        });

        it('should handle parseError lines gracefully', function () {
            serviceCallStub.onSecondCall().returns({
                ok: true,
                object: 'not valid json\n' + successLine
            });

            var results = batchService.getBatchResults('batch_done', 'gpt-4');

            expect(results[0].customId).to.equal('unknown');
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.be.an.instanceof(Error);
            expect(results[0].error.errorType).to.equal('ProviderError');

            expect(results[1].customId).to.equal('req-1');
            expect(results[1].success).to.be.true;
        });

        it('should throw BatchSubmissionError when batch not complete', function () {
            serviceCallStub.onFirstCall().returns({
                ok: true,
                object: {
                    id: 'batch_pending',
                    status: 'in_progress',
                    request_counts: { total: 5, completed: 2, failed: 0 },
                    created_at: 1700000000,
                    expires_at: 1700086400,
                    output_file_id: null
                }
            });

            expect(function () {
                batchService.getBatchResults('batch_pending', 'gpt-4');
            }).to.throw(/Batch is not yet complete/);
        });

        it('should throw BatchSubmissionError when no output file available', function () {
            serviceCallStub.onFirstCall().returns({
                ok: true,
                object: {
                    id: 'batch_no_file',
                    status: 'completed',
                    request_counts: { total: 5, completed: 5, failed: 0 },
                    created_at: 1700000000,
                    expires_at: 1700086400,
                    output_file_id: null
                }
            });

            expect(function () {
                batchService.getBatchResults('batch_no_file', 'gpt-4');
            }).to.throw(/No output file available/);
        });
    });

    describe('cancelBatch', function () {

        beforeEach(function () {
            serviceCallStub.returns({
                ok: true,
                object: {
                    id: 'batch_cancel_123',
                    object: 'batch',
                    status: 'cancelling'
                }
            });
        });

        it('should return { batchId, status: "cancelling" }', function () {
            var result = batchService.cancelBatch('batch_cancel_123');

            expect(result).to.deep.equal({
                batchId: 'batch_cancel_123',
                status: 'cancelling'
            });
        });

        it('should POST to /v1/batches/{batchId}/cancel', function () {
            batchService.cancelBatch('batch_cancel_123');

            var createRequestFn = createServiceCalls[0].callbacks.createRequest;
            createRequestFn(mockSvc, { batchId: 'batch_cancel_123' });

            expect(mockSvc.setURL.calledWith('https://api.openai.com/v1/batches/batch_cancel_123/cancel')).to.be.true;
            expect(mockSvc.setRequestMethod.calledWith('POST')).to.be.true;
        });

        it('should throw ProviderError on failure', function () {
            serviceCallStub.returns({
                ok: false,
                errorMessage: 'Cannot cancel batch'
            });

            expect(function () {
                batchService.cancelBatch('batch_cancel_123');
            }).to.throw(/OpenAI batch cancellation failed/);
        });
    });
});
