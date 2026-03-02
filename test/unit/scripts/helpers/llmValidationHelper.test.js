'use strict';

var chai = require('chai');
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();
var expect = chai.expect;

describe('llmValidationHelper', function() {
    
    var llmValidationHelper;
    var mockConfigHelper;
    var isModelAllowedStub;
    
    beforeEach(function() {
        isModelAllowedStub = sinon.stub();
        
        // Mock Config Helper
        mockConfigHelper = {
            VALID_PROVIDERS: ['openai', 'anthropic', 'gemini'],
            isModelAllowed: isModelAllowedStub
        };
        
        // By default, allow all models
        isModelAllowedStub.returns(true);
        
        llmValidationHelper = proxyquire('../../../../cartridge/scripts/helpers/llmValidationHelper', {
            '*/cartridge/scripts/helpers/llmConfigHelper': mockConfigHelper
        });
    });
    
    afterEach(function() {
        sinon.restore();
    });
    
    describe('VALID_ROLES', function() {
        
        it('should contain system, user, and assistant', function() {
            expect(llmValidationHelper.VALID_ROLES).to.be.an('array');
            expect(llmValidationHelper.VALID_ROLES).to.include('system');
            expect(llmValidationHelper.VALID_ROLES).to.include('user');
            expect(llmValidationHelper.VALID_ROLES).to.include('assistant');
        });
    });
    
    describe('validateMessages', function() {
        
        it('should return valid:false when messages is not an array', function() {
            var result = llmValidationHelper.validateMessages('not an array');
            
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('messages must be an array');
        });
        
        it('should return valid:false when messages is null', function() {
            var result = llmValidationHelper.validateMessages(null);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('messages must be an array');
        });
        
        it('should return valid:false when messages is undefined', function() {
            var result = llmValidationHelper.validateMessages(undefined);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('messages must be an array');
        });
        
        it('should return valid:false when messages array is empty', function() {
            var result = llmValidationHelper.validateMessages([]);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('messages array cannot be empty');
        });
        
        it('should return valid:false when message lacks role property', function() {
            var result = llmValidationHelper.validateMessages([{ content: 'Hello' }]);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('index 0');
            expect(result.error).to.include('role');
        });
        
        it('should return valid:false when message lacks content property', function() {
            var result = llmValidationHelper.validateMessages([{ role: 'user' }]);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('content');
        });
        
        it('should return valid:false for invalid role value', function() {
            var result = llmValidationHelper.validateMessages([{ role: 'invalid', content: 'Hello' }]);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('invalid role');
        });
        
        it('should return valid:true for valid user message', function() {
            var result = llmValidationHelper.validateMessages([{ role: 'user', content: 'Hello' }]);
            
            expect(result.valid).to.be.true;
            expect(result.error).to.be.undefined;
        });
        
        it('should return valid:true for valid system message', function() {
            var result = llmValidationHelper.validateMessages([{ role: 'system', content: 'You are helpful' }]);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:true for valid assistant message', function() {
            var result = llmValidationHelper.validateMessages([{ role: 'assistant', content: 'Hello!' }]);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:true for multi-message conversation', function() {
            var result = llmValidationHelper.validateMessages([
                { role: 'system', content: 'Be helpful' },
                { role: 'user', content: 'Hi' },
                { role: 'assistant', content: 'Hello!' }
            ]);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:false when second message in array is invalid', function() {
            var result = llmValidationHelper.validateMessages([
                { role: 'user', content: 'Hi' },
                { role: 'user' }
            ]);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('index 1');
        });
        
        it('should return valid:false for message that is not an object', function() {
            var result = llmValidationHelper.validateMessages(['not an object']);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('must be an object');
        });
        
        it('should return valid:false for message with non-string content', function() {
            var result = llmValidationHelper.validateMessages([{ role: 'user', content: 123 }]);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('content');
        });
    });
    
    describe('validateRequest', function() {
        
        var validRequest;
        
        beforeEach(function() {
            validRequest = {
                provider: 'openai',
                model: 'gpt-5-mini',
                messages: [{ role: 'user', content: 'Hello' }]
            };
        });
        
        it('should return valid:false when requestObj is null', function() {
            var result = llmValidationHelper.validateRequest(null);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request object is required');
        });
        
        it('should return valid:false when requestObj is undefined', function() {
            var result = llmValidationHelper.validateRequest(undefined);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request object is required');
        });
        
        it('should return valid:false when provider is missing', function() {
            delete validRequest.provider;
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('provider');
        });
        
        it('should return valid:false when provider is invalid', function() {
            validRequest.provider = 'invalid';
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('Invalid provider');
        });
        
        it('should return valid:false when model is missing', function() {
            delete validRequest.model;
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('model');
        });
        
        it('should return valid:false when model is empty string', function() {
            validRequest.model = '';
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
        });
        
        it('should return valid:false when model is whitespace only', function() {
            validRequest.model = '   ';
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
        });
        
        it('should return valid:false when model is not allowed', function() {
            isModelAllowedStub.returns(false);
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('not available');
        });
        
        it('should return valid:true for complete valid request', function() {
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:true when params is omitted', function() {
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:true when params is null', function() {
            validRequest.params = null;
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:true when params is undefined', function() {
            validRequest.params = undefined;
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:true when params is valid object', function() {
            validRequest.params = { temperature: 0.7, max_tokens: 100 };
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.true;
        });
        
        it('should return valid:false when params is an array', function() {
            validRequest.params = [1, 2, 3];
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('params must be an object');
        });
        
        it('should call isModelAllowed with correct arguments', function() {
            llmValidationHelper.validateRequest(validRequest);
            
            expect(isModelAllowedStub.calledOnce).to.be.true;
            expect(isModelAllowedStub.calledWith('openai', 'gpt-5-mini')).to.be.true;
        });
        
        it('should validate messages array', function() {
            validRequest.messages = [];
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.false;
            expect(result.error).to.include('messages');
        });
        
        it('should work with anthropic provider', function() {
            validRequest.provider = 'anthropic';
            validRequest.model = 'claude-sonnet-4-5';
            
            var result = llmValidationHelper.validateRequest(validRequest);
            
            expect(result.valid).to.be.true;
        });
        
        it('should work with gemini provider', function() {
            validRequest.provider = 'gemini';
            validRequest.model = 'gemini-3-flash-preview';

            var result = llmValidationHelper.validateRequest(validRequest);

            expect(result.valid).to.be.true;
        });
    });

    describe('validateBatchRequest', function() {

        var validBatchRequest;

        beforeEach(function() {
            validBatchRequest = {
                provider: 'openai',
                model: 'gpt-5-mini',
                requests: [
                    {
                        customId: 'req-1',
                        messages: [{ role: 'user', content: 'Hello' }]
                    },
                    {
                        customId: 'req-2',
                        messages: [{ role: 'user', content: 'World' }]
                    }
                ]
            };
        });

        it('should return valid:true for a complete valid batch request', function() {
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.true;
            expect(result.error).to.be.undefined;
        });

        it('should return valid:false when request object is null', function() {
            var result = llmValidationHelper.validateBatchRequest(null);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request object is required');
        });

        it('should return valid:false when request object is undefined', function() {
            var result = llmValidationHelper.validateBatchRequest(undefined);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request object is required');
        });

        it('should return valid:false when request object is falsy (empty string)', function() {
            var result = llmValidationHelper.validateBatchRequest('');
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request object is required');
        });

        it('should return valid:false when provider is missing', function() {
            delete validBatchRequest.provider;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('provider');
        });

        it('should return valid:false when provider is empty string', function() {
            validBatchRequest.provider = '';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('provider');
        });

        it('should return valid:false when provider is not in VALID_PROVIDERS', function() {
            validBatchRequest.provider = 'invalid_provider';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('provider');
        });

        it('should return valid:false when model is missing', function() {
            delete validBatchRequest.model;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('model');
        });

        it('should return valid:false when model is empty string', function() {
            validBatchRequest.model = '';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('model');
        });

        it('should return valid:false when model is whitespace only', function() {
            validBatchRequest.model = '   ';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('model');
        });

        it('should return valid:false when model is not allowed by isModelAllowed', function() {
            isModelAllowedStub.returns(false);
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.include('not available');
        });

        it('should call isModelAllowed with correct provider and model arguments', function() {
            validBatchRequest.provider = 'anthropic';
            validBatchRequest.model = 'claude-sonnet-4-5';
            llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(isModelAllowedStub.calledWith('anthropic', 'claude-sonnet-4-5')).to.be.true;
        });

        it('should return valid:false when requests is not an array (string)', function() {
            validBatchRequest.requests = 'not-array';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('requests must be a non-empty array');
        });

        it('should return valid:false when requests is not an array (object)', function() {
            validBatchRequest.requests = {};
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('requests must be a non-empty array');
        });

        it('should return valid:false when requests is null', function() {
            validBatchRequest.requests = null;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('requests must be a non-empty array');
        });

        it('should return valid:false when requests is an empty array', function() {
            validBatchRequest.requests = [];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('requests must be a non-empty array');
        });

        it('should return valid:false when OpenAI requests exceed 50000 items', function() {
            validBatchRequest.provider = 'openai';
            var bigArray = [];
            for (var i = 0; i < 50001; i++) {
                bigArray.push({ customId: 'id-' + i, messages: [{ role: 'user', content: 'Hi' }] });
            }
            validBatchRequest.requests = bigArray;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('OpenAI batch requests cannot exceed 50000 items');
        });

        it('should return valid:false when Anthropic requests exceed 100000 items', function() {
            validBatchRequest.provider = 'anthropic';
            var bigArray = [];
            for (var i = 0; i < 100001; i++) {
                bigArray.push({ customId: 'id-' + i, messages: [{ role: 'user', content: 'Hi' }] });
            }
            validBatchRequest.requests = bigArray;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Anthropic batch requests cannot exceed 100000 items');
        });

        it('should return valid:false when a request item is null', function() {
            validBatchRequest.requests = [null];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 must be an object');
        });

        it('should return valid:false when a request item is a non-object (number)', function() {
            validBatchRequest.requests = [42];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 must be an object');
        });

        it('should return valid:false when customId is missing on a request item', function() {
            validBatchRequest.requests = [{ messages: [{ role: 'user', content: 'Hi' }] }];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 must have a string customId');
        });

        it('should return valid:false when customId is empty string', function() {
            validBatchRequest.requests[0].customId = '';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 must have a string customId');
        });

        it('should return valid:false when customId is not a string (number)', function() {
            validBatchRequest.requests[0].customId = 123;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 must have a string customId');
        });

        it('should return valid:false when messages in a request item are invalid', function() {
            validBatchRequest.requests[0].messages = 'not-array';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.match(/^Request item at index 0: /);
        });

        it('should return valid:false with correct index for invalid item at index 1', function() {
            validBatchRequest.requests[1].messages = null;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.match(/^Request item at index 1: /);
        });

        it('should return valid:false when params on a request item is an array', function() {
            validBatchRequest.requests[0].params = [1, 2, 3];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 has invalid params: must be an object');
        });

        it('should return valid:false when params on a request item is a string', function() {
            validBatchRequest.requests[0].params = 'string';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Request item at index 0 has invalid params: must be an object');
        });

        it('should return valid:true when params is null (explicitly allowed)', function() {
            validBatchRequest.requests[0].params = null;
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.true;
        });

        it('should return valid:true when params is undefined (allowed)', function() {
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.true;
        });

        it('should return valid:true when params is a valid object', function() {
            validBatchRequest.requests[0].params = { temperature: 0.7 };
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.true;
        });

        it('should return valid:false when customIds are duplicated', function() {
            validBatchRequest.requests[0].customId = 'dup-id';
            validBatchRequest.requests[1].customId = 'dup-id';
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Duplicate customId: dup-id');
        });

        it('should return valid:true when all customIds are unique', function() {
            validBatchRequest.requests = [
                { customId: 'a', messages: [{ role: 'user', content: 'Hi' }] },
                { customId: 'b', messages: [{ role: 'user', content: 'Hi' }] },
                { customId: 'c', messages: [{ role: 'user', content: 'Hi' }] }
            ];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.true;
        });

        it('should detect duplicate even among many items', function() {
            validBatchRequest.requests = [
                { customId: 'a', messages: [{ role: 'user', content: 'Hi' }] },
                { customId: 'b', messages: [{ role: 'user', content: 'Hi' }] },
                { customId: 'c', messages: [{ role: 'user', content: 'Hi' }] },
                { customId: 'd', messages: [{ role: 'user', content: 'Hi' }] },
                { customId: 'b', messages: [{ role: 'user', content: 'Hi' }] }
            ];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.equal('Duplicate customId: b');
        });

        it('should work with all three valid providers', function() {
            var providers = ['openai', 'anthropic', 'gemini'];
            for (var i = 0; i < providers.length; i++) {
                validBatchRequest.provider = providers[i];
                var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
                expect(result.valid).to.be.true;
            }
        });

        it('should validate items before checking for duplicate customIds', function() {
            validBatchRequest.requests = [
                { customId: 'a', messages: 'invalid' },
                { customId: 'a', messages: [{ role: 'user', content: 'Hi' }] }
            ];
            var result = llmValidationHelper.validateBatchRequest(validBatchRequest);
            expect(result.valid).to.be.false;
            expect(result.error).to.match(/^Request item at index 0: /);
        });
    });
});
