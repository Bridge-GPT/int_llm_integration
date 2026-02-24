'use strict';

var chai = require('chai');
var sinon = require('sinon');
var expect = chai.expect;

var llmNormalizationHelper = require('../../../../cartridge/scripts/helpers/llmNormalizationHelper');

describe('llmNormalizationHelper', function() {
    
    afterEach(function() {
        sinon.restore();
    });
    
    // ============================================
    // PAYLOAD BUILDERS
    // ============================================
    
    describe('buildOpenAIPayload', function() {
        
        it('should set model from normalized request', function() {
            var result = llmNormalizationHelper.buildOpenAIPayload({
                model: 'gpt-5-mini',
                messages: [{ role: 'user', content: 'Hi' }]
            });
            
            expect(result.model).to.equal('gpt-5-mini');
        });
        
        it('should pass messages array unchanged', function() {
            var messages = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi!' }
            ];
            
            var result = llmNormalizationHelper.buildOpenAIPayload({
                model: 'gpt-5-mini',
                messages: messages
            });
            
            expect(result.messages).to.deep.equal(messages);
        });
        
        it('should spread params into payload', function() {
            var result = llmNormalizationHelper.buildOpenAIPayload({
                model: 'gpt-5-mini',
                messages: [{ role: 'user', content: 'Hi' }],
                params: { temperature: 0.7, max_tokens: 150 }
            });
            
            expect(result.temperature).to.equal(0.7);
            expect(result.max_tokens).to.equal(150);
        });
        
        it('should work without params', function() {
            var result = llmNormalizationHelper.buildOpenAIPayload({
                model: 'gpt-5-mini',
                messages: [{ role: 'user', content: 'Hi' }]
            });
            
            expect(result.model).to.equal('gpt-5-mini');
            expect(result.messages).to.be.an('array');
            expect(result.temperature).to.be.undefined;
        });
        
        it('should include system messages in messages array', function() {
            var messages = [
                { role: 'system', content: 'Be helpful' },
                { role: 'user', content: 'Hi' }
            ];
            
            var result = llmNormalizationHelper.buildOpenAIPayload({
                model: 'gpt-5-mini',
                messages: messages
            });
            
            expect(result.messages).to.have.lengthOf(2);
            expect(result.messages[0].role).to.equal('system');
        });
    });
    
    describe('buildAnthropicPayload', function() {
        
        it('should extract system message to separate property', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [
                    { role: 'system', content: 'Be helpful' },
                    { role: 'user', content: 'Hi' }
                ]
            });
            
            expect(result.system).to.equal('Be helpful');
            expect(result.messages).to.have.lengthOf(1);
            expect(result.messages[0].role).to.equal('user');
        });
        
        it('should filter messages to only user and assistant roles', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [
                    { role: 'system', content: 'System' },
                    { role: 'user', content: 'User' },
                    { role: 'assistant', content: 'Assistant' }
                ]
            });
            
            expect(result.messages).to.have.lengthOf(2);
            expect(result.messages[0].content).to.equal('User');
            expect(result.messages[1].content).to.equal('Assistant');
        });
        
        it('should set default max_tokens to 16384', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [{ role: 'user', content: 'Hi' }]
            });
            
            expect(result.max_tokens).to.equal(16384);
        });
        
        it('should use max_tokens from params if provided', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [{ role: 'user', content: 'Hi' }],
                params: { max_tokens: 1000 }
            });
            
            expect(result.max_tokens).to.equal(1000);
        });
        
        it('should work without system message', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [{ role: 'user', content: 'Hi' }]
            });
            
            expect(result.system).to.be.undefined;
            expect(result.messages).to.have.lengthOf(1);
        });
        
        it('should set model correctly', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-opus-4-5',
                messages: [{ role: 'user', content: 'Hi' }]
            });
            
            expect(result.model).to.equal('claude-opus-4-5');
        });
        
        it('should spread other params into payload', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [{ role: 'user', content: 'Hi' }],
                params: { temperature: 0.5 }
            });
            
            expect(result.temperature).to.equal(0.5);
        });
        
        it('should concatenate multiple system messages', function() {
            var result = llmNormalizationHelper.buildAnthropicPayload({
                model: 'claude-sonnet-4-5',
                messages: [
                    { role: 'system', content: 'First instruction' },
                    { role: 'system', content: 'Second instruction' },
                    { role: 'user', content: 'Hi' }
                ]
            });
            
            expect(result.system).to.include('First instruction');
            expect(result.system).to.include('Second instruction');
        });
    });
    
    describe('buildGeminiPayload', function() {
        
        it('should transform messages to contents array format', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [{ role: 'user', content: 'Hello' }]
            });
            
            expect(result.contents).to.be.an('array');
            expect(result.contents[0]).to.deep.equal({
                role: 'user',
                parts: [{ text: 'Hello' }]
            });
        });
        
        it('should map assistant role to model role', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [
                    { role: 'user', content: 'Hi' },
                    { role: 'assistant', content: 'Hello!' }
                ]
            });
            
            expect(result.contents[1].role).to.equal('model');
            expect(result.contents[1].parts[0].text).to.equal('Hello!');
        });
        
        it('should handle system message via systemInstruction', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [
                    { role: 'system', content: 'Be concise' },
                    { role: 'user', content: 'Hi' }
                ]
            });
            
            expect(result.systemInstruction).to.exist;
            expect(result.systemInstruction.parts[0].text).to.equal('Be concise');
            // Contents should not include system message
            expect(result.contents.every(function(c) { return c.role !== 'system'; })).to.be.true;
        });
        
        it('should add generationConfig from params', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [{ role: 'user', content: 'Hi' }],
                params: { temperature: 0.5, maxOutputTokens: 200 }
            });
            
            expect(result.generationConfig).to.exist;
            expect(result.generationConfig.temperature).to.equal(0.5);
            expect(result.generationConfig.maxOutputTokens).to.equal(200);
        });
        
        it('should map max_tokens to maxOutputTokens', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [{ role: 'user', content: 'Hi' }],
                params: { max_tokens: 500 }
            });
            
            expect(result.generationConfig.maxOutputTokens).to.equal(500);
        });
        
        it('should work without params', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [{ role: 'user', content: 'Hi' }]
            });
            
            expect(result.contents).to.be.an('array');
            expect(result.generationConfig).to.be.undefined;
        });
        
        it('should handle topP and topK params', function() {
            var result = llmNormalizationHelper.buildGeminiPayload({
                model: 'gemini-3-flash-preview',
                messages: [{ role: 'user', content: 'Hi' }],
                params: { topP: 0.9, topK: 40 }
            });
            
            expect(result.generationConfig.topP).to.equal(0.9);
            expect(result.generationConfig.topK).to.equal(40);
        });
    });
    
    // ============================================
    // RESPONSE NORMALIZERS
    // ============================================
    
    describe('normalizeOpenAIResponse', function() {
        
        var openAIResponse;
        
        beforeEach(function() {
            openAIResponse = {
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: 1234567890,
                model: 'gpt-5-mini-2025-01-15',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'Hello!' },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15
                }
            };
        });
        
        it('should extract content from choices array', function() {
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.content).to.equal('Hello!');
        });
        
        it('should set provider to openai', function() {
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.provider).to.equal('openai');
        });
        
        it('should extract model from response', function() {
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.model).to.equal('gpt-5-mini-2025-01-15');
        });
        
        it('should use requested model if response model is missing', function() {
            delete openAIResponse.model;
            
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.model).to.equal('gpt-5-mini');
        });
        
        it('should map usage tokens correctly', function() {
            openAIResponse.usage = {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150
            };
            
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.usage.promptTokens).to.equal(100);
            expect(result.usage.completionTokens).to.equal(50);
            expect(result.usage.totalTokens).to.equal(150);
        });
        
        it('should extract finish reason', function() {
            openAIResponse.choices[0].finish_reason = 'length';
            
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.finishReason).to.equal('length');
        });
        
        it('should handle missing usage', function() {
            delete openAIResponse.usage;
            
            var result = llmNormalizationHelper.normalizeOpenAIResponse(openAIResponse, 'gpt-5-mini');
            
            expect(result.usage.promptTokens).to.equal(0);
            expect(result.usage.completionTokens).to.equal(0);
            expect(result.usage.totalTokens).to.equal(0);
        });
    });
    
    describe('normalizeAnthropicResponse', function() {
        
        var anthropicResponse;
        
        beforeEach(function() {
            anthropicResponse = {
                id: 'msg_123',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-4-5',
                content: [{
                    type: 'text',
                    text: 'Anthropic response'
                }],
                stop_reason: 'end_turn',
                usage: {
                    input_tokens: 20,
                    output_tokens: 30
                }
            };
        });
        
        it('should extract content from content array', function() {
            var result = llmNormalizationHelper.normalizeAnthropicResponse(anthropicResponse, 'claude-sonnet-4-5');
            
            expect(result.content).to.equal('Anthropic response');
        });
        
        it('should set provider to anthropic', function() {
            var result = llmNormalizationHelper.normalizeAnthropicResponse(anthropicResponse, 'claude-sonnet-4-5');
            
            expect(result.provider).to.equal('anthropic');
        });
        
        it('should extract model from response', function() {
            var result = llmNormalizationHelper.normalizeAnthropicResponse(anthropicResponse, 'claude-sonnet-4-5');
            
            expect(result.model).to.equal('claude-sonnet-4-5');
        });
        
        it('should map usage tokens correctly', function() {
            var result = llmNormalizationHelper.normalizeAnthropicResponse(anthropicResponse, 'claude-sonnet-4-5');
            
            expect(result.usage.promptTokens).to.equal(20);
            expect(result.usage.completionTokens).to.equal(30);
            expect(result.usage.totalTokens).to.equal(50);
        });
        
        it('should extract stop_reason as finishReason', function() {
            var result = llmNormalizationHelper.normalizeAnthropicResponse(anthropicResponse, 'claude-sonnet-4-5');
            
            expect(result.finishReason).to.equal('end_turn');
        });
        
        it('should handle missing usage', function() {
            delete anthropicResponse.usage;
            
            var result = llmNormalizationHelper.normalizeAnthropicResponse(anthropicResponse, 'claude-sonnet-4-5');
            
            expect(result.usage.promptTokens).to.equal(0);
            expect(result.usage.completionTokens).to.equal(0);
        });
    });
    
    describe('normalizeGeminiResponse', function() {
        
        var geminiResponse;
        
        beforeEach(function() {
            geminiResponse = {
                candidates: [{
                    content: {
                        parts: [{ text: 'Gemini response' }],
                        role: 'model'
                    },
                    finishReason: 'STOP',
                    index: 0
                }],
                usageMetadata: {
                    promptTokenCount: 12,
                    candidatesTokenCount: 18,
                    totalTokenCount: 30
                }
            };
        });
        
        it('should extract content from candidates array', function() {
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.content).to.equal('Gemini response');
        });
        
        it('should set provider to gemini', function() {
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.provider).to.equal('gemini');
        });
        
        it('should use requested model', function() {
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.model).to.equal('gemini-3-flash-preview');
        });
        
        it('should map usage metadata correctly', function() {
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.usage.promptTokens).to.equal(12);
            expect(result.usage.completionTokens).to.equal(18);
            expect(result.usage.totalTokens).to.equal(30);
        });
        
        it('should extract finishReason', function() {
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.finishReason).to.equal('STOP');
        });
        
        it('should handle missing usageMetadata', function() {
            delete geminiResponse.usageMetadata;
            
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.usage.promptTokens).to.equal(0);
            expect(result.usage.completionTokens).to.equal(0);
        });
        
        it('should handle empty candidates', function() {
            geminiResponse.candidates = [];
            
            var result = llmNormalizationHelper.normalizeGeminiResponse(geminiResponse, 'gemini-3-flash-preview');
            
            expect(result.content).to.equal('');
            expect(result.finishReason).to.be.null;
        });
    });
});
