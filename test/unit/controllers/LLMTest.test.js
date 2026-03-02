'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('LLMTest Controller', function () {
    let controller;
    let ISMLMock;
    let CSRFProtectionMock;
    let LoggerMock;
    let SystemMock;
    let configHelperMock;
    let llmClientMock;
    let llmBatchClientMock;
    let requestMock;
    let responseMock;
    let writtenOutput;

    beforeEach(function () {
        writtenOutput = '';

        ISMLMock = {
            renderTemplate: sinon.stub()
        };

        CSRFProtectionMock = {
            generateToken: sinon.stub().returns('test-csrf-token'),
            getTokenName: sinon.stub().returns('csrf_token'),
            validateRequest: sinon.stub().returns(true)
        };

        LoggerMock = {
            getLogger: sinon.stub().returns({
                info: sinon.stub(),
                warn: sinon.stub(),
                error: sinon.stub()
            })
        };

        SystemMock = {
            getInstanceType: sinon.stub().returns(0),
            DEVELOPMENT_SYSTEM: 0,
            STAGING_SYSTEM: 1,
            PRODUCTION_SYSTEM: 2
        };

        configHelperMock = {
            isTestModeEnabled: sinon.stub().returns(true),
            VALID_PROVIDERS: ['openai', 'anthropic', 'gemini'],
            loadLLMConfiguration: sinon.stub().returns({
                llmAvailableModelsJson: JSON.stringify({
                    openai: { cheap: 'gpt-5-nano', basic: 'gpt-5-mini' },
                    anthropic: { basic: 'claude-sonnet-4-5' },
                    gemini: { basic: 'gemini-3-flash-preview' }
                }),
                llmAnthropicApiVersion: '2024-01-01',
                llmDebugMode: false
            }),
            parseAvailableModels: sinon.stub().returns({
                openai: { cheap: 'gpt-5-nano', basic: 'gpt-5-mini' },
                anthropic: { basic: 'claude-sonnet-4-5' },
                gemini: { basic: 'gemini-3-flash-preview' }
            })
        };

        llmClientMock = {
            generateText: sinon.stub().returns({
                provider: 'openai',
                model: 'gpt-5-mini',
                content: 'Connection working!',
                finishReason: 'stop',
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
            })
        };

        // Default: submitBatch returns 'completed' so the poll loop is skipped in most tests.
        // Tests that need polling override submitBatch to return a non-terminal status.
        llmBatchClientMock = {
            submitBatch: sinon.stub().returns({
                batchId: 'batch-123',
                provider: 'openai',
                status: 'completed',
                totalRequests: 1,
                createdAt: '2025-01-01T00:00:00Z'
            }),
            getBatchStatus: sinon.stub().returns({
                batchId: 'batch-123',
                provider: 'openai',
                status: 'completed',
                requestCounts: { total: 1, completed: 1, failed: 0 }
            }),
            getBatchResults: sinon.stub().returns({
                batchId: 'batch-123',
                provider: 'openai',
                results: [
                    {
                        customId: 'connectivity-test-1',
                        success: true,
                        response: {
                            provider: 'openai',
                            model: 'gpt-5-mini',
                            content: 'OK',
                            finishReason: 'stop',
                            usage: { promptTokens: 8, completionTokens: 1, totalTokens: 9 }
                        }
                    }
                ]
            })
        };

        requestMock = {
            httpParameterMap: {
                provider: { stringValue: 'openai' },
                model: { stringValue: 'gpt-5-mini' }
            }
        };

        responseMock = {
            setContentType: sinon.stub(),
            setStatus: sinon.stub(),
            getWriter: sinon.stub().returns({
                print: sinon.stub().callsFake(function (text) {
                    writtenOutput += text;
                })
            })
        };

        global.request = requestMock;
        global.response = responseMock;

        controller = proxyquire('../../../cartridge/controllers/LLMTest', {
            'dw/template/ISML': ISMLMock,
            'dw/web/CSRFProtection': CSRFProtectionMock,
            'dw/system/Logger': LoggerMock,
            'dw/system/System': SystemMock,
            '*/cartridge/scripts/helpers/llmConfigHelper': configHelperMock,
            '*/cartridge/scripts/helpers/llmClient': llmClientMock,
            '*/cartridge/scripts/helpers/llmBatchClient': llmBatchClientMock
        });
    });

    afterEach(function () {
        delete global.request;
        delete global.response;
        sinon.restore();
    });

    function parseOutput() {
        return JSON.parse(writtenOutput);
    }

    describe('Show', function () {
        it('should render template with testModeEnabled=false when test mode is off', function () {
            configHelperMock.isTestModeEnabled.returns(false);

            controller.Show();

            expect(ISMLMock.renderTemplate.calledOnce).to.be.true;
            const args = ISMLMock.renderTemplate.firstCall.args;
            expect(args[0]).to.equal('llmTest/connectionTest');
            expect(args[1].testModeEnabled).to.be.false;
        });

        it('should render template with CSRF token, providers, and modelsMapJson when test mode is on', function () {
            controller.Show();

            expect(ISMLMock.renderTemplate.calledOnce).to.be.true;
            const args = ISMLMock.renderTemplate.firstCall.args;
            expect(args[0]).to.equal('llmTest/connectionTest');
            expect(args[1].testModeEnabled).to.be.true;
            expect(args[1].csrfToken).to.equal('test-csrf-token');
            expect(args[1].csrfTokenName).to.equal('csrf_token');
            expect(args[1].providers).to.deep.equal(['openai', 'anthropic', 'gemini']);

            const modelsMap = JSON.parse(args[1].modelsMapJson);
            expect(modelsMap.openai).to.include('gpt-5-nano');
            expect(modelsMap.openai).to.include('gpt-5-mini');
        });
    });

    describe('Test (sync)', function () {
        it('should return 403 when test mode is disabled', function () {
            configHelperMock.isTestModeEnabled.returns(false);

            controller.Test();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.success).to.be.false;
            expect(data.error).to.include('test mode');
        });

        it('should return 403 when CSRF validation fails', function () {
            CSRFProtectionMock.validateRequest.returns(false);

            controller.Test();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('CSRF');
        });

        it('should return 400 when provider is missing', function () {
            requestMock.httpParameterMap.provider.stringValue = null;

            controller.Test();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('provider');
        });

        it('should return 400 when model is missing', function () {
            requestMock.httpParameterMap.model.stringValue = null;

            controller.Test();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('model');
        });

        it('should return success JSON on successful sync test', function () {
            controller.Test();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.provider).to.equal('openai');
            expect(data.model).to.equal('gpt-5-mini');
            expect(data.response).to.equal('Connection working!');
            expect(data).to.have.property('durationMs');
        });

        it('should set status 401 for AuthenticationError', function () {
            var err = new Error('Invalid API key');
            err.errorType = 'AuthenticationError';
            err.isLLMError = true;
            llmClientMock.generateText.throws(err);

            controller.Test();

            expect(responseMock.setStatus.calledWith(401)).to.be.true;
            const data = parseOutput();
            expect(data.errorType).to.equal('AuthenticationError');
        });

        it('should set status 429 for RateLimitError', function () {
            var err = new Error('Rate limit');
            err.errorType = 'RateLimitError';
            err.isLLMError = true;
            llmClientMock.generateText.throws(err);

            controller.Test();

            expect(responseMock.setStatus.calledWith(429)).to.be.true;
        });

        it('should set status 400 for ValidationError', function () {
            var err = new Error('Invalid params');
            err.errorType = 'ValidationError';
            err.isLLMError = true;
            llmClientMock.generateText.throws(err);

            controller.Test();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
        });

        it('should set status 500 for ConfigurationError', function () {
            var err = new Error('Config missing');
            err.errorType = 'ConfigurationError';
            err.isLLMError = true;
            llmClientMock.generateText.throws(err);

            controller.Test();

            expect(responseMock.setStatus.calledWith(500)).to.be.true;
            const data = parseOutput();
            expect(data.hint).to.include('Site Preferences');
        });

        it('should set status 500 for unknown errors', function () {
            llmClientMock.generateText.throws(new Error('Something broke'));

            controller.Test();

            expect(responseMock.setStatus.calledWith(500)).to.be.true;
        });
    });

    describe('BatchTest (submit-only)', function () {
        it('should return 403 when test mode is disabled', function () {
            configHelperMock.isTestModeEnabled.returns(false);

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
        });

        it('should return 403 when CSRF validation fails', function () {
            CSRFProtectionMock.validateRequest.returns(false);

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('CSRF');
        });

        it('should return 400 when provider is missing', function () {
            requestMock.httpParameterMap.provider.stringValue = null;

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
        });

        it('should return 400 when model is missing', function () {
            requestMock.httpParameterMap.model.stringValue = null;

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
        });

        it('should return batchId and status on successful submit', function () {
            controller.BatchTest();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.batchId).to.equal('batch-123');
            expect(data.provider).to.equal('openai');
            expect(data.status).to.equal('completed');
            expect(data.totalRequests).to.equal(1);
            expect(data).to.have.property('durationMs');
        });

        it('should set status 401 for AuthenticationError', function () {
            var err = new Error('Batch submit failed');
            err.errorType = 'AuthenticationError';
            err.isLLMError = true;
            llmBatchClientMock.submitBatch.throws(err);

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(401)).to.be.true;
            const data = parseOutput();
            expect(data.success).to.be.false;
            expect(data.errorType).to.equal('AuthenticationError');
        });

        it('should set status 429 for RateLimitError', function () {
            var err = new Error('Rate limit');
            err.errorType = 'RateLimitError';
            llmBatchClientMock.submitBatch.throws(err);

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(429)).to.be.true;
        });

        it('should set status 400 for ValidationError', function () {
            var err = new Error('Invalid');
            err.errorType = 'ValidationError';
            llmBatchClientMock.submitBatch.throws(err);

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
        });

        it('should set status 500 for unknown errors', function () {
            llmBatchClientMock.submitBatch.throws(new Error('Something broke'));

            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(500)).to.be.true;
        });
    });

    describe('BatchStatus', function () {
        beforeEach(function () {
            requestMock.httpParameterMap.batchId = { stringValue: 'batch-123' };
        });

        it('should return 403 when test mode is disabled', function () {
            configHelperMock.isTestModeEnabled.returns(false);

            controller.BatchStatus();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
        });

        it('should return 400 when provider is missing', function () {
            requestMock.httpParameterMap.provider.stringValue = null;

            controller.BatchStatus();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('provider');
        });

        it('should return 400 when batchId is missing', function () {
            requestMock.httpParameterMap.batchId.stringValue = null;

            controller.BatchStatus();

            expect(responseMock.setStatus.calledWith(400)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('batchId');
        });

        it('should return completed status with LLM response', function () {
            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.batchId).to.equal('batch-123');
            expect(data.status).to.equal('completed');
            expect(data.response).to.equal('OK');
            expect(data.model).to.equal('gpt-5-mini');
            expect(data.usage).to.deep.equal({ promptTokens: 8, completionTokens: 1, totalTokens: 9 });
            expect(data.finishReason).to.equal('stop');
        });

        it('should return non-terminal status without results', function () {
            llmBatchClientMock.getBatchStatus.returns({
                batchId: 'batch-123', provider: 'openai', status: 'processing'
            });

            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.status).to.equal('processing');
            expect(data).to.not.have.property('response');
        });

        it('should return failure when batch status is failed', function () {
            llmBatchClientMock.getBatchStatus.returns({
                batchId: 'batch-123', provider: 'openai', status: 'failed'
            });

            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.false;
            expect(data.error).to.include('failed');
        });

        it('should return failure when batch status is expired', function () {
            llmBatchClientMock.getBatchStatus.returns({
                batchId: 'batch-123', provider: 'openai', status: 'expired'
            });

            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.false;
            expect(data.error).to.include('expired');
        });

        it('should return failure when batch status is cancelled', function () {
            llmBatchClientMock.getBatchStatus.returns({
                batchId: 'batch-123', provider: 'openai', status: 'cancelled'
            });

            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.false;
            expect(data.error).to.include('cancelled');
        });

        it('should handle result with error in first item', function () {
            llmBatchClientMock.getBatchResults.returns({
                batchId: 'batch-123',
                provider: 'openai',
                results: [{
                    customId: 'connectivity-test-1',
                    success: false,
                    error: { message: 'Model overloaded' }
                }]
            });

            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.resultError).to.deep.equal({ message: 'Model overloaded' });
        });

        it('should handle getBatchResults throwing', function () {
            llmBatchClientMock.getBatchResults.throws(new Error('Could not download'));

            controller.BatchStatus();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.resultError).to.equal('Could not download');
        });

        it('should set status 500 on getBatchStatus error', function () {
            llmBatchClientMock.getBatchStatus.throws(new Error('Service down'));

            controller.BatchStatus();

            expect(responseMock.setStatus.calledWith(500)).to.be.true;
            const data = parseOutput();
            expect(data.success).to.be.false;
        });
    });

    describe('Ping', function () {
        it('should return 403 when test mode is disabled', function () {
            configHelperMock.isTestModeEnabled.returns(false);

            controller.Ping();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
        });

        it('should return pong when test mode is enabled', function () {
            controller.Ping();

            expect(responseMock.setContentType.calledWith('text/plain')).to.be.true;
            expect(writtenOutput).to.include('pong');
        });
    });

    describe('Config', function () {
        it('should return 403 when test mode is disabled', function () {
            configHelperMock.isTestModeEnabled.returns(false);

            controller.Config();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
        });

        it('should return config JSON when test mode is enabled', function () {
            controller.Config();

            const data = parseOutput();
            expect(data.success).to.be.true;
            expect(data.configuration.validProviders).to.deep.equal(['openai', 'anthropic', 'gemini']);
        });
    });

    describe('Production guard', function () {
        beforeEach(function () {
            SystemMock.getInstanceType.returns(SystemMock.PRODUCTION_SYSTEM);
            requestMock.httpParameterMap.batchId = { stringValue: 'batch-123' };
        });

        it('should return 403 for Show on production', function () {
            controller.Show();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.success).to.be.false;
            expect(data.error).to.include('not available in production');
            expect(ISMLMock.renderTemplate.called).to.be.false;
        });

        it('should return 403 for Ping on production', function () {
            controller.Ping();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('not available in production');
        });

        it('should return 403 for Test on production', function () {
            controller.Test();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('not available in production');
        });

        it('should return 403 for BatchTest on production', function () {
            controller.BatchTest();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('not available in production');
        });

        it('should return 403 for BatchStatus on production', function () {
            controller.BatchStatus();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('not available in production');
        });

        it('should return 403 for Config on production', function () {
            controller.Config();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('not available in production');
        });

        it('should block on production even when test mode is enabled', function () {
            configHelperMock.isTestModeEnabled.returns(true);

            controller.Test();

            expect(responseMock.setStatus.calledWith(403)).to.be.true;
            const data = parseOutput();
            expect(data.error).to.include('not available in production');
        });

        it('should allow requests on staging instances', function () {
            SystemMock.getInstanceType.returns(SystemMock.STAGING_SYSTEM);

            controller.Ping();

            expect(responseMock.setStatus.calledWith(403)).to.be.false;
            expect(writtenOutput).to.include('pong');
        });
    });

    describe('Exports', function () {
        it('should export Show as public', function () {
            expect(controller.Show).to.be.a('function');
            expect(controller.Show.public).to.be.true;
        });

        it('should export Ping as public', function () {
            expect(controller.Ping).to.be.a('function');
            expect(controller.Ping.public).to.be.true;
        });

        it('should export Test as public', function () {
            expect(controller.Test).to.be.a('function');
            expect(controller.Test.public).to.be.true;
        });

        it('should export BatchTest as public', function () {
            expect(controller.BatchTest).to.be.a('function');
            expect(controller.BatchTest.public).to.be.true;
        });

        it('should export BatchStatus as public', function () {
            expect(controller.BatchStatus).to.be.a('function');
            expect(controller.BatchStatus.public).to.be.true;
        });

        it('should export Config as public', function () {
            expect(controller.Config).to.be.a('function');
            expect(controller.Config.public).to.be.true;
        });
    });
});
