'use strict';

var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();
var expect = chai.expect;

describe('llmBatchClient', function() {

    var llmBatchClient;
    var mockValidationHelper;
    var mockConfigHelper;
    var mockErrorHelper;
    var mockNormalizationHelper;
    var mockOpenAIBatchService;
    var mockAnthropicBatchService;
    var mockGeminiBatchService;
    var mockLogger;

    beforeEach(function() {
        mockLogger = {
            getLogger: sinon.stub().returns({
                info: sinon.stub(),
                error: sinon.stub(),
                warn: sinon.stub(),
                debug: sinon.stub()
            })
        };

        mockValidationHelper = {
            validateBatchRequest: sinon.stub().returns({ valid: true }),
            validateRequest: sinon.stub(),
            validateMessages: sinon.stub(),
            VALID_ROLES: ['system', 'user', 'assistant']
        };

        mockConfigHelper = {
            VALID_PROVIDERS: ['openai', 'anthropic', 'gemini'],
            isModelAllowed: sinon.stub().returns(true),
            resolveProviderForModel: sinon.stub().returns('openai'),
            isDebugMode: sinon.stub().returns(false),
            getAnthropicApiVersion: sinon.stub().returns('2024-01-01')
        };

        mockErrorHelper = {
            ERROR_TYPES: {
                ValidationError: 'ValidationError',
                BatchSubmissionError: 'BatchSubmissionError',
                BatchExpiredError: 'BatchExpiredError',
                ProviderError: 'ProviderError',
                ConfigurationError: 'ConfigurationError'
            },
            createLLMError: sinon.stub().callsFake(function(msg, type, status) {
                var err = new Error(msg);
                err.errorType = type;
                err.statusCode = status;
                err.isLLMError = true;
                return err;
            }),
            sanitizeForLogging: sinon.stub().callsFake(function(msg) { return msg; })
        };

        mockNormalizationHelper = {
            buildOpenAIPayload: sinon.stub().callsFake(function(req) {
                return { model: req.model, messages: req.messages };
            }),
            buildAnthropicPayload: sinon.stub().callsFake(function(req) {
                return { model: req.model, messages: req.messages };
            }),
            buildGeminiPayload: sinon.stub().callsFake(function(req) {
                return { contents: req.messages };
            }),
            normalizeOpenAIResponse: sinon.stub(),
            normalizeAnthropicResponse: sinon.stub(),
            normalizeGeminiResponse: sinon.stub()
        };

        mockOpenAIBatchService = {
            submitBatch: sinon.stub().returns({
                batchId: 'batch_openai_123',
                status: 'validating',
                requestCounts: { total: 2, completed: 0, failed: 0 },
                createdAt: 1700000000
            }),
            getBatchStatus: sinon.stub().returns({
                batchId: 'batch_openai_123',
                status: 'completed',
                requestCounts: { total: 2, completed: 2, failed: 0 },
                createdAt: 1700000000,
                expiresAt: 1700086400
            }),
            getBatchResults: sinon.stub().returns([
                { customId: 'r1', success: true, response: { provider: 'openai', content: 'Hello', rawResponse: {} } }
            ]),
            cancelBatch: sinon.stub().returns({ batchId: 'batch_openai_123', status: 'cancelling' })
        };

        mockAnthropicBatchService = {
            submitBatch: sinon.stub().returns({
                batchId: 'msgbatch_123',
                status: 'in_progress',
                requestCounts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
                createdAt: '2024-01-01T00:00:00Z',
                expiresAt: '2024-01-02T00:00:00Z'
            }),
            getBatchStatus: sinon.stub().returns({
                batchId: 'msgbatch_123',
                status: 'completed',
                requestCounts: { total: 2, completed: 2, failed: 0 },
                createdAt: '2024-01-01T00:00:00Z',
                expiresAt: '2024-01-02T00:00:00Z'
            }),
            getBatchResults: sinon.stub().returns([
                { customId: 'r1', success: true, response: { provider: 'anthropic', content: 'Hi', rawResponse: {} } }
            ]),
            cancelBatch: sinon.stub().returns({ batchId: 'msgbatch_123', status: 'cancelling' })
        };

        mockGeminiBatchService = {
            submitBatch: sinon.stub().returns({
                batchId: 'batches/mock-123',
                status: 'pending',
                requestCounts: { total: 2, completed: 0, failed: 0 },
                createdAt: '2024-01-01T00:00:00Z'
            }),
            getBatchStatus: sinon.stub().returns({
                batchId: 'batches/mock-123',
                status: 'completed',
                requestCounts: { total: 2, completed: 2, failed: 0 },
                createdAt: '2024-01-01T00:00:00Z',
                expiresAt: null
            }),
            getBatchResults: sinon.stub().returns([
                { customId: 'r1', success: true, response: { provider: 'gemini', content: 'Hey', rawResponse: {} } }
            ]),
            cancelBatch: sinon.stub().returns({ batchId: 'batches/mock-123', status: 'cancelling' })
        };

        llmBatchClient = proxyquire('../../../../cartridge/scripts/helpers/llmBatchClient', {
            'dw/system/Logger': mockLogger,
            '*/cartridge/scripts/helpers/llmValidationHelper': mockValidationHelper,
            '*/cartridge/scripts/helpers/llmConfigHelper': mockConfigHelper,
            '*/cartridge/scripts/helpers/llmErrorHelper': mockErrorHelper,
            '*/cartridge/scripts/helpers/llmNormalizationHelper': mockNormalizationHelper,
            '*/cartridge/scripts/services/llmOpenAIBatchService': mockOpenAIBatchService,
            '*/cartridge/scripts/services/llmAnthropicBatchService': mockAnthropicBatchService,
            '*/cartridge/scripts/services/llmGeminiBatchService': mockGeminiBatchService
        });
    });

    afterEach(function() {
        sinon.restore();
    });

    describe('BATCH_STATUSES', function() {
        it('should export all unified status values', function() {
            expect(llmBatchClient.BATCH_STATUSES).to.deep.equal({
                pending: 'pending',
                processing: 'processing',
                completed: 'completed',
                failed: 'failed',
                expired: 'expired',
                cancelling: 'cancelling',
                cancelled: 'cancelled'
            });
        });
    });

    describe('submitBatch', function() {

        var validOptions;

        beforeEach(function() {
            validOptions = {
                provider: 'openai',
                model: 'gpt-5-mini',
                requests: [
                    { customId: 'r1', messages: [{ role: 'user', content: 'Hello' }] },
                    { customId: 'r2', messages: [{ role: 'user', content: 'World' }] }
                ]
            };
        });

        it('should route to OpenAI batch service', function() {
            var result = llmBatchClient.submitBatch(validOptions);
            expect(mockOpenAIBatchService.submitBatch.calledOnce).to.be.true;
            expect(result.provider).to.equal('openai');
            expect(result.batchId).to.equal('batch_openai_123');
        });

        it('should route to Anthropic batch service', function() {
            validOptions.provider = 'anthropic';
            var result = llmBatchClient.submitBatch(validOptions);
            expect(mockAnthropicBatchService.submitBatch.calledOnce).to.be.true;
            expect(result.provider).to.equal('anthropic');
        });

        it('should route to Gemini batch service', function() {
            validOptions.provider = 'gemini';
            var result = llmBatchClient.submitBatch(validOptions);
            expect(mockGeminiBatchService.submitBatch.calledOnce).to.be.true;
            expect(result.provider).to.equal('gemini');
        });

        it('should call validateBatchRequest', function() {
            llmBatchClient.submitBatch(validOptions);
            expect(mockValidationHelper.validateBatchRequest.calledOnce).to.be.true;
            expect(mockValidationHelper.validateBatchRequest.calledWith(validOptions)).to.be.true;
        });

        it('should throw ValidationError on invalid request', function() {
            mockValidationHelper.validateBatchRequest.returns({ valid: false, error: 'test error' });
            expect(function() {
                llmBatchClient.submitBatch(validOptions);
            }).to.throw('test error');
        });

        it('should build payloads using buildOpenAIPayload for openai provider', function() {
            llmBatchClient.submitBatch(validOptions);
            expect(mockNormalizationHelper.buildOpenAIPayload.callCount).to.equal(2);
        });

        it('should build payloads using buildAnthropicPayload for anthropic provider', function() {
            validOptions.provider = 'anthropic';
            llmBatchClient.submitBatch(validOptions);
            expect(mockNormalizationHelper.buildAnthropicPayload.callCount).to.equal(2);
        });

        it('should build payloads using buildGeminiPayload for gemini provider', function() {
            validOptions.provider = 'gemini';
            llmBatchClient.submitBatch(validOptions);
            expect(mockNormalizationHelper.buildGeminiPayload.callCount).to.equal(2);
        });

        it('should return correct shape', function() {
            var result = llmBatchClient.submitBatch(validOptions);
            expect(result).to.have.all.keys('batchId', 'provider', 'status', 'totalRequests', 'createdAt');
            expect(result.totalRequests).to.equal(2);
        });

        it('should resolve provider from model when provider is omitted', function() {
            delete validOptions.provider;
            mockConfigHelper.resolveProviderForModel.returns('openai');
            llmBatchClient.submitBatch(validOptions);
            expect(mockConfigHelper.resolveProviderForModel.calledWith('gpt-5-mini')).to.be.true;
            expect(mockOpenAIBatchService.submitBatch.calledOnce).to.be.true;
        });

        it('should re-throw LLM errors from provider service', function() {
            var llmErr = new Error('Provider failed');
            llmErr.isLLMError = true;
            llmErr.errorType = 'BatchSubmissionError';
            mockOpenAIBatchService.submitBatch.throws(llmErr);
            expect(function() {
                llmBatchClient.submitBatch(validOptions);
            }).to.throw('Provider failed');
        });

        it('should wrap non-LLM errors in ProviderError', function() {
            mockOpenAIBatchService.submitBatch.throws(new Error('unexpected'));
            expect(function() {
                llmBatchClient.submitBatch(validOptions);
            }).to.throw();
            expect(mockErrorHelper.createLLMError.called).to.be.true;
        });

        it('should pass items with customId and payload to provider service', function() {
            llmBatchClient.submitBatch(validOptions);
            var args = mockOpenAIBatchService.submitBatch.firstCall.args;
            expect(args[0]).to.equal('gpt-5-mini');
            expect(args[1]).to.be.an('array').with.lengthOf(2);
            expect(args[1][0]).to.have.property('customId', 'r1');
            expect(args[1][0]).to.have.property('payload');
        });
    });

    describe('getBatchStatus', function() {

        it('should route to OpenAI batch service', function() {
            var result = llmBatchClient.getBatchStatus({ provider: 'openai', batchId: 'batch_123' });
            expect(mockOpenAIBatchService.getBatchStatus.calledWith('batch_123')).to.be.true;
            expect(result.provider).to.equal('openai');
        });

        it('should route to Anthropic batch service', function() {
            var result = llmBatchClient.getBatchStatus({ provider: 'anthropic', batchId: 'msgbatch_123' });
            expect(mockAnthropicBatchService.getBatchStatus.calledWith('msgbatch_123')).to.be.true;
            expect(result.provider).to.equal('anthropic');
        });

        it('should route to Gemini batch service', function() {
            var result = llmBatchClient.getBatchStatus({ provider: 'gemini', batchId: 'batches/123' });
            expect(mockGeminiBatchService.getBatchStatus.calledWith('batches/123')).to.be.true;
            expect(result.provider).to.equal('gemini');
        });

        it('should return correct shape', function() {
            var result = llmBatchClient.getBatchStatus({ provider: 'openai', batchId: 'batch_123' });
            expect(result).to.have.all.keys('batchId', 'provider', 'status', 'requestCounts', 'createdAt', 'expiresAt');
        });

        it('should throw ValidationError when provider is missing', function() {
            expect(function() {
                llmBatchClient.getBatchStatus({ batchId: 'batch_123' });
            }).to.throw();
        });

        it('should throw ValidationError when batchId is missing', function() {
            expect(function() {
                llmBatchClient.getBatchStatus({ provider: 'openai' });
            }).to.throw();
        });

        it('should throw ValidationError for unknown provider', function() {
            expect(function() {
                llmBatchClient.getBatchStatus({ provider: 'unknown', batchId: 'x' });
            }).to.throw();
        });
    });

    describe('getBatchResults', function() {

        it('should route to OpenAI batch service', function() {
            var result = llmBatchClient.getBatchResults({ provider: 'openai', batchId: 'batch_123', model: 'gpt-5-mini' });
            expect(mockOpenAIBatchService.getBatchResults.calledWith('batch_123', 'gpt-5-mini')).to.be.true;
            expect(result.provider).to.equal('openai');
        });

        it('should return correct shape', function() {
            var result = llmBatchClient.getBatchResults({ provider: 'openai', batchId: 'batch_123' });
            expect(result).to.have.all.keys('batchId', 'provider', 'results');
            expect(result.results).to.be.an('array');
        });

        it('should strip rawResponse when debug mode is off', function() {
            mockConfigHelper.isDebugMode.returns(false);
            var result = llmBatchClient.getBatchResults({ provider: 'openai', batchId: 'batch_123' });
            expect(result.results[0].response).to.not.have.property('rawResponse');
        });

        it('should keep rawResponse when debug mode is on', function() {
            mockConfigHelper.isDebugMode.returns(true);
            var result = llmBatchClient.getBatchResults({ provider: 'openai', batchId: 'batch_123' });
            expect(result.results[0].response).to.have.property('rawResponse');
        });

        it('should throw ValidationError when provider is missing', function() {
            expect(function() {
                llmBatchClient.getBatchResults({ batchId: 'batch_123' });
            }).to.throw();
        });

        it('should throw ValidationError when batchId is missing', function() {
            expect(function() {
                llmBatchClient.getBatchResults({ provider: 'openai' });
            }).to.throw();
        });
    });

    describe('cancelBatch', function() {

        it('should route to OpenAI batch service', function() {
            var result = llmBatchClient.cancelBatch({ provider: 'openai', batchId: 'batch_123' });
            expect(mockOpenAIBatchService.cancelBatch.calledWith('batch_123')).to.be.true;
            expect(result).to.deep.equal({ batchId: 'batch_123', provider: 'openai', status: 'cancelling' });
        });

        it('should route to Anthropic batch service', function() {
            var result = llmBatchClient.cancelBatch({ provider: 'anthropic', batchId: 'msgbatch_123' });
            expect(mockAnthropicBatchService.cancelBatch.calledWith('msgbatch_123')).to.be.true;
            expect(result.provider).to.equal('anthropic');
        });

        it('should route to Gemini batch service', function() {
            var result = llmBatchClient.cancelBatch({ provider: 'gemini', batchId: 'batches/123' });
            expect(mockGeminiBatchService.cancelBatch.calledWith('batches/123')).to.be.true;
            expect(result.provider).to.equal('gemini');
        });

        it('should return correct shape', function() {
            var result = llmBatchClient.cancelBatch({ provider: 'openai', batchId: 'batch_123' });
            expect(result).to.have.all.keys('batchId', 'provider', 'status');
        });

        it('should throw ValidationError when provider is missing', function() {
            expect(function() {
                llmBatchClient.cancelBatch({ batchId: 'batch_123' });
            }).to.throw();
        });

        it('should throw ValidationError when batchId is missing', function() {
            expect(function() {
                llmBatchClient.cancelBatch({ provider: 'openai' });
            }).to.throw();
        });
    });
});
