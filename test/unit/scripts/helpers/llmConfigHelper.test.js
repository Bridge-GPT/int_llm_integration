'use strict';

var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();
var expect = chai.expect;

describe('llmConfigHelper', function() {
    
    var llmConfigHelper;
    var mockSite;
    var mockSystem;
    var mockLogger;
    var mockErrorHelper;
    var preferenceValues;
    
    beforeEach(function() {
        // Default preference values
        preferenceValues = {
            llmAvailableModelsJson: JSON.stringify({
                openai: { cheap: 'gpt-5-nano', basic: 'gpt-5-mini' },
                anthropic: { cheap: 'claude-haiku-4-5', basic: 'claude-sonnet-4-5' },
                gemini: { cheap: 'gemini-2.5-flash-lite', basic: 'gemini-3-flash-preview' }
            }),
            llmAnthropicApiVersion: '2024-01-01',
            llmDebugMode: false
        };
        
        // Mock Site
        mockSite = {
            getCurrent: sinon.stub().returns({
                getCustomPreferenceValue: sinon.stub().callsFake(function(prefName) {
                    return preferenceValues[prefName];
                })
            })
        };
        
        // Mock System
        mockSystem = {
            getInstanceType: sinon.stub().returns(0),
            DEVELOPMENT_SYSTEM: 0,
            STAGING_SYSTEM: 1,
            PRODUCTION_SYSTEM: 2
        };

        // Mock Logger
        mockLogger = {
            info: sinon.stub(),
            error: sinon.stub(),
            warn: sinon.stub(),
            debug: sinon.stub()
        };
        
        var mockLoggerModule = {
            getLogger: sinon.stub().returns(mockLogger)
        };
        
        // Mock Error Helper - create actual error objects
        mockErrorHelper = {
            ERROR_TYPES: {
                ValidationError: 'ValidationError',
                AuthenticationError: 'AuthenticationError',
                RateLimitError: 'RateLimitError',
                TimeoutError: 'TimeoutError',
                ProviderError: 'ProviderError',
                ConfigurationError: 'ConfigurationError',
                NetworkError: 'NetworkError'
            },
            createLLMError: function(message, errorType, status, providerError) {
                var error = new Error(message);
                error.errorType = errorType;
                error.status = status;
                error.providerError = providerError;
                error.isLLMError = true;
                return error;
            }
        };
        
        llmConfigHelper = proxyquire('../../../../cartridge/scripts/helpers/llmConfigHelper', {
            'dw/system/Site': mockSite,
            'dw/system/System': mockSystem,
            'dw/system/Logger': mockLoggerModule,
            '*/cartridge/scripts/helpers/llmErrorHelper': mockErrorHelper
        });
    });
    
    afterEach(function() {
        sinon.restore();
    });
    
    describe('VALID_PROVIDERS', function() {
        
        it('should contain openai, anthropic, and gemini', function() {
            expect(llmConfigHelper.VALID_PROVIDERS).to.be.an('array');
            expect(llmConfigHelper.VALID_PROVIDERS).to.deep.equal(['openai', 'anthropic', 'gemini']);
        });
        
        it('should have exactly 3 providers', function() {
            expect(llmConfigHelper.VALID_PROVIDERS).to.have.lengthOf(3);
        });
    });
    
    describe('loadLLMConfiguration', function() {
        
        it('should retrieve all three preferences from Site', function() {
            var config = llmConfigHelper.loadLLMConfiguration();
            
            var siteInstance = mockSite.getCurrent();
            expect(siteInstance.getCustomPreferenceValue.calledWith('llmAvailableModelsJson')).to.be.true;
            expect(siteInstance.getCustomPreferenceValue.calledWith('llmAnthropicApiVersion')).to.be.true;
            expect(siteInstance.getCustomPreferenceValue.calledWith('llmDebugMode')).to.be.true;
        });
        
        it('should return object with all three properties', function() {
            var config = llmConfigHelper.loadLLMConfiguration();
            
            expect(config).to.have.property('llmAvailableModelsJson');
            expect(config).to.have.property('llmAnthropicApiVersion');
            expect(config).to.have.property('llmDebugMode');
        });
        
        it('should return correct preference values', function() {
            var config = llmConfigHelper.loadLLMConfiguration();
            
            expect(config.llmAvailableModelsJson).to.equal(preferenceValues.llmAvailableModelsJson);
            expect(config.llmAnthropicApiVersion).to.equal('2024-01-01');
            expect(config.llmDebugMode).to.equal(false);
        });
    });
    
    describe('parseAvailableModels', function() {
        
        it('should throw ConfigurationError when jsonString is null', function() {
            expect(function() {
                llmConfigHelper.parseAvailableModels(null);
            }).to.throw();
            
            try {
                llmConfigHelper.parseAvailableModels(null);
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.message).to.include('not configured');
            }
        });
        
        it('should throw ConfigurationError when jsonString is empty string', function() {
            expect(function() {
                llmConfigHelper.parseAvailableModels('');
            }).to.throw();
            
            try {
                llmConfigHelper.parseAvailableModels('');
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
            }
        });
        
        it('should throw ConfigurationError for invalid JSON', function() {
            expect(function() {
                llmConfigHelper.parseAvailableModels('{ invalid json }');
            }).to.throw();
            
            try {
                llmConfigHelper.parseAvailableModels('{ invalid json }');
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.message).to.include('invalid JSON');
            }
        });
        
        it('should return parsed object for valid JSON', function() {
            var result = llmConfigHelper.parseAvailableModels('{"openai":{"basic":"gpt-5-mini"}}');
            
            expect(result).to.deep.equal({ openai: { basic: 'gpt-5-mini' } });
        });
        
        it('should throw ConfigurationError for empty object JSON', function() {
            expect(function() {
                llmConfigHelper.parseAvailableModels('{}');
            }).to.throw();
            
            try {
                llmConfigHelper.parseAvailableModels('{}');
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.message).to.include('at least one provider');
            }
        });
    });
    
    describe('getAvailableModels', function() {
        
        it('should return models for valid provider', function() {
            var result = llmConfigHelper.getAvailableModels('openai');
            
            expect(result).to.deep.equal({ cheap: 'gpt-5-nano', basic: 'gpt-5-mini' });
        });
        
        it('should throw ConfigurationError for invalid provider', function() {
            expect(function() {
                llmConfigHelper.getAvailableModels('invalid-provider');
            }).to.throw();
            
            try {
                llmConfigHelper.getAvailableModels('invalid-provider');
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.message).to.include('Invalid provider');
            }
        });
        
        it('should return empty object when provider not in JSON', function() {
            preferenceValues.llmAvailableModelsJson = JSON.stringify({
                openai: { basic: 'gpt-5-mini' }
            });
            
            var result = llmConfigHelper.getAvailableModels('gemini');
            
            expect(result).to.deep.equal({});
        });
        
        it('should return models for anthropic provider', function() {
            var result = llmConfigHelper.getAvailableModels('anthropic');
            
            expect(result).to.deep.equal({ cheap: 'claude-haiku-4-5', basic: 'claude-sonnet-4-5' });
        });
        
        it('should return models for gemini provider', function() {
            var result = llmConfigHelper.getAvailableModels('gemini');
            
            expect(result).to.deep.equal({ cheap: 'gemini-2.5-flash-lite', basic: 'gemini-3-flash-preview' });
        });
    });
    
    describe('isModelAllowed', function() {
        
        it('should return true when model exists in provider tier values', function() {
            var result = llmConfigHelper.isModelAllowed('openai', 'gpt-5-mini');
            
            expect(result).to.be.true;
        });
        
        it('should return false when model does not exist for provider', function() {
            var result = llmConfigHelper.isModelAllowed('openai', 'gpt-3.5-turbo');
            
            expect(result).to.be.false;
        });
        
        it('should return false for valid provider with no models configured', function() {
            preferenceValues.llmAvailableModelsJson = JSON.stringify({
                openai: {}
            });
            
            var result = llmConfigHelper.isModelAllowed('openai', 'gpt-5-mini');
            
            expect(result).to.be.false;
        });
        
        it('should return true for model in cheap tier', function() {
            var result = llmConfigHelper.isModelAllowed('openai', 'gpt-5-nano');
            
            expect(result).to.be.true;
        });
        
        it('should return false for invalid provider', function() {
            var result = llmConfigHelper.isModelAllowed('invalid', 'some-model');
            
            expect(result).to.be.false;
        });
        
        it('should handle anthropic models', function() {
            expect(llmConfigHelper.isModelAllowed('anthropic', 'claude-sonnet-4-5')).to.be.true;
            expect(llmConfigHelper.isModelAllowed('anthropic', 'claude-nonexistent')).to.be.false;
        });
        
        it('should handle gemini models', function() {
            expect(llmConfigHelper.isModelAllowed('gemini', 'gemini-3-flash-preview')).to.be.true;
            expect(llmConfigHelper.isModelAllowed('gemini', 'gemini-nonexistent')).to.be.false;
        });
    });
    
    describe('getAnthropicApiVersion', function() {
        
        it('should return version string when preference is set', function() {
            var result = llmConfigHelper.getAnthropicApiVersion();
            
            expect(result).to.equal('2024-01-01');
        });
        
        it('should throw ConfigurationError when preference is empty', function() {
            preferenceValues.llmAnthropicApiVersion = '';
            
            expect(function() {
                llmConfigHelper.getAnthropicApiVersion();
            }).to.throw();
            
            try {
                llmConfigHelper.getAnthropicApiVersion();
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.message).to.include('Anthropic');
            }
        });
        
        it('should throw ConfigurationError when preference is null', function() {
            preferenceValues.llmAnthropicApiVersion = null;
            
            expect(function() {
                llmConfigHelper.getAnthropicApiVersion();
            }).to.throw();
            
            try {
                llmConfigHelper.getAnthropicApiVersion();
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
            }
        });
    });
    
    describe('isDebugMode', function() {
        
        it('should return false when debug mode is disabled', function() {
            var result = llmConfigHelper.isDebugMode();
            
            expect(result).to.be.false;
        });
        
        it('should return true when debug mode is enabled', function() {
            preferenceValues.llmDebugMode = true;
            
            var result = llmConfigHelper.isDebugMode();
            
            expect(result).to.be.true;
        });
        
        it('should return false when preference is null', function() {
            preferenceValues.llmDebugMode = null;

            var result = llmConfigHelper.isDebugMode();

            expect(result).to.be.false;
        });
    });

    describe('getDefaultModel', function() {

        it('should return model string when preference is set', function() {
            preferenceValues.llmDefaultModel = 'gpt-5.2';

            var result = llmConfigHelper.getDefaultModel();

            expect(result).to.equal('gpt-5.2');
        });

        it('should throw ConfigurationError when preference is null', function() {
            preferenceValues.llmDefaultModel = null;

            expect(function() {
                llmConfigHelper.getDefaultModel();
            }).to.throw();

            try {
                llmConfigHelper.getDefaultModel();
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.isLLMError).to.be.true;
                expect(e.message).to.include('llmDefaultModel');
            }
        });

        it('should throw ConfigurationError when preference is empty string', function() {
            preferenceValues.llmDefaultModel = '';

            expect(function() {
                llmConfigHelper.getDefaultModel();
            }).to.throw();

            try {
                llmConfigHelper.getDefaultModel();
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
            }
        });
    });

    describe('resolveProviderForModel', function() {

        it('should return openai for gpt-5-mini', function() {
            var result = llmConfigHelper.resolveProviderForModel('gpt-5-mini');

            expect(result).to.equal('openai');
        });

        it('should return anthropic for claude-sonnet-4-5', function() {
            var result = llmConfigHelper.resolveProviderForModel('claude-sonnet-4-5');

            expect(result).to.equal('anthropic');
        });

        it('should return gemini for gemini-3-flash-preview', function() {
            var result = llmConfigHelper.resolveProviderForModel('gemini-3-flash-preview');

            expect(result).to.equal('gemini');
        });

        it('should find model in cheap tier', function() {
            var result = llmConfigHelper.resolveProviderForModel('gpt-5-nano');

            expect(result).to.equal('openai');
        });

        it('should throw ConfigurationError when model not found', function() {
            expect(function() {
                llmConfigHelper.resolveProviderForModel('nonexistent-model');
            }).to.throw();

            try {
                llmConfigHelper.resolveProviderForModel('nonexistent-model');
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
                expect(e.isLLMError).to.be.true;
                expect(e.message).to.include('not found');
            }
        });

        it('should throw ConfigurationError when model is null', function() {
            expect(function() {
                llmConfigHelper.resolveProviderForModel(null);
            }).to.throw();

            try {
                llmConfigHelper.resolveProviderForModel(null);
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
            }
        });

        it('should throw ConfigurationError when model is empty string', function() {
            expect(function() {
                llmConfigHelper.resolveProviderForModel('');
            }).to.throw();

            try {
                llmConfigHelper.resolveProviderForModel('');
            } catch (e) {
                expect(e.errorType).to.equal('ConfigurationError');
            }
        });
    });

    describe('isTestModeEnabled', function() {

        it('should return false when preference is null', function() {
            preferenceValues.llmTestModeEnabled = null;

            var result = llmConfigHelper.isTestModeEnabled();

            expect(result).to.be.false;
        });

        it('should return false when preference is false', function() {
            preferenceValues.llmTestModeEnabled = false;

            var result = llmConfigHelper.isTestModeEnabled();

            expect(result).to.be.false;
        });

        it('should return true when preference is true', function() {
            preferenceValues.llmTestModeEnabled = true;

            var result = llmConfigHelper.isTestModeEnabled();

            expect(result).to.be.true;
        });

        it('should return false on production even when preference is true', function() {
            preferenceValues.llmTestModeEnabled = true;
            mockSystem.getInstanceType.returns(mockSystem.PRODUCTION_SYSTEM);

            var result = llmConfigHelper.isTestModeEnabled();

            expect(result).to.be.false;
        });

        it('should return true on staging when preference is true', function() {
            preferenceValues.llmTestModeEnabled = true;
            mockSystem.getInstanceType.returns(mockSystem.STAGING_SYSTEM);

            var result = llmConfigHelper.isTestModeEnabled();

            expect(result).to.be.true;
        });
    });

    describe('getSystemInstructions', function() {

        it('should return instructions string when preference is set', function() {
            preferenceValues.llmSystemInstructions = 'We are a luxury fashion retailer.';

            var result = llmConfigHelper.getSystemInstructions();

            expect(result).to.equal('We are a luxury fashion retailer.');
        });

        it('should return null when preference is empty string', function() {
            preferenceValues.llmSystemInstructions = '';

            var result = llmConfigHelper.getSystemInstructions();

            expect(result).to.be.null;
        });

        it('should return null when preference is null', function() {
            preferenceValues.llmSystemInstructions = null;

            var result = llmConfigHelper.getSystemInstructions();

            expect(result).to.be.null;
        });
    });
});
