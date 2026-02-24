'use strict';

var chai = require('chai');
var sinon = require('sinon');
var expect = chai.expect;

var llmErrorHelper = require('../../../../cartridge/scripts/helpers/llmErrorHelper');

describe('llmErrorHelper', function() {
    
    afterEach(function() {
        sinon.restore();
    });
    
    describe('ERROR_TYPES', function() {
        
        it('should export all expected error type strings', function() {
            expect(llmErrorHelper.ERROR_TYPES).to.be.an('object');
            expect(llmErrorHelper.ERROR_TYPES.ValidationError).to.equal('ValidationError');
            expect(llmErrorHelper.ERROR_TYPES.AuthenticationError).to.equal('AuthenticationError');
            expect(llmErrorHelper.ERROR_TYPES.RateLimitError).to.equal('RateLimitError');
            expect(llmErrorHelper.ERROR_TYPES.TimeoutError).to.equal('TimeoutError');
            expect(llmErrorHelper.ERROR_TYPES.ProviderError).to.equal('ProviderError');
            expect(llmErrorHelper.ERROR_TYPES.ConfigurationError).to.equal('ConfigurationError');
            expect(llmErrorHelper.ERROR_TYPES.NetworkError).to.equal('NetworkError');
        });
        
        it('should have exactly 7 error types', function() {
            var keys = Object.keys(llmErrorHelper.ERROR_TYPES);
            expect(keys).to.have.lengthOf(7);
        });
    });
    
    describe('createLLMError', function() {
        
        it('should return an Error object with all custom properties attached', function() {
            var error = llmErrorHelper.createLLMError(
                'Test error message',
                'ValidationError',
                400,
                { detail: 'invalid input' }
            );
            
            expect(error).to.be.an.instanceof(Error);
            expect(error.message).to.equal('Test error message');
            expect(error.errorType).to.equal('ValidationError');
            expect(error.status).to.equal(400);
            expect(error.providerError).to.deep.equal({ detail: 'invalid input' });
            expect(error.isLLMError).to.equal(true);
        });
        
        it('should work with minimal parameters (no providerError)', function() {
            var error = llmErrorHelper.createLLMError(
                'Minimal error',
                'NetworkError',
                500
            );
            
            expect(error).to.be.an.instanceof(Error);
            expect(error.message).to.equal('Minimal error');
            expect(error.errorType).to.equal('NetworkError');
            expect(error.status).to.equal(500);
            expect(error.providerError).to.be.undefined;
            expect(error.isLLMError).to.equal(true);
        });
        
        it('should work with null providerError', function() {
            var error = llmErrorHelper.createLLMError(
                'Error with null provider',
                'ProviderError',
                500,
                null
            );
            
            expect(error.providerError).to.be.null;
        });
    });
    
    describe('mapProviderError', function() {
        
        it('should return AuthenticationError for 401 status', function() {
            var error = llmErrorHelper.mapProviderError('openai', 401, { error: { message: 'Invalid API key' } });
            
            expect(error.errorType).to.equal('AuthenticationError');
            expect(error.message).to.include('Invalid API key');
            expect(error.status).to.equal(401);
            expect(error.isLLMError).to.equal(true);
        });
        
        it('should return AuthenticationError for 403 status', function() {
            var error = llmErrorHelper.mapProviderError('anthropic', 403, { message: 'Forbidden' });
            
            expect(error.errorType).to.equal('AuthenticationError');
            expect(error.status).to.equal(403);
        });
        
        it('should return RateLimitError for 429 status', function() {
            var error = llmErrorHelper.mapProviderError('openai', 429, { error: { message: 'Rate limit exceeded' } });
            
            expect(error.errorType).to.equal('RateLimitError');
            expect(error.message).to.include('Rate limit exceeded');
        });
        
        it('should return ValidationError for 400 status', function() {
            var error = llmErrorHelper.mapProviderError('gemini', 400, { error: { message: 'Invalid model' } });
            
            expect(error.errorType).to.equal('ValidationError');
            expect(error.message).to.include('Invalid model');
        });
        
        it('should return ProviderError for 500 status', function() {
            var error = llmErrorHelper.mapProviderError('anthropic', 500, { detail: 'Internal server error' });
            
            expect(error.errorType).to.equal('ProviderError');
            expect(error.status).to.equal(500);
        });
        
        it('should return ProviderError for 503 status', function() {
            var error = llmErrorHelper.mapProviderError('openai', 503, { error: { message: 'Service unavailable' } });
            
            expect(error.errorType).to.equal('ProviderError');
            expect(error.status).to.equal(503);
        });
        
        it('should return ProviderError for other 5xx statuses', function() {
            var error = llmErrorHelper.mapProviderError('gemini', 502, { message: 'Bad gateway' });
            
            expect(error.errorType).to.equal('ProviderError');
            expect(error.status).to.equal(502);
        });
        
        it('should extract message from Anthropic error format (errorBody.message)', function() {
            var error = llmErrorHelper.mapProviderError('anthropic', 400, { message: 'Anthropic specific message' });
            
            expect(error.message).to.include('Anthropic specific message');
        });
        
        it('should extract message from OpenAI error format (errorBody.error.message)', function() {
            var error = llmErrorHelper.mapProviderError('openai', 400, { error: { message: 'OpenAI specific message' } });
            
            expect(error.message).to.include('OpenAI specific message');
        });
        
        it('should include provider name in error message', function() {
            var error = llmErrorHelper.mapProviderError('openai', 400, { message: 'test' });
            
            expect(error.message).to.include('openai');
        });
        
        it('should handle null errorBody', function() {
            var error = llmErrorHelper.mapProviderError('openai', 400, null);
            
            expect(error).to.be.an.instanceof(Error);
            expect(error.errorType).to.equal('ValidationError');
        });
        
        it('should handle empty errorBody', function() {
            var error = llmErrorHelper.mapProviderError('openai', 500, {});
            
            expect(error).to.be.an.instanceof(Error);
            expect(error.errorType).to.equal('ProviderError');
        });
    });
    
    describe('sanitizeForLogging', function() {
        
        it('should redact OpenAI-style API keys (sk-...)', function() {
            var result = llmErrorHelper.sanitizeForLogging(
                'Authorization failed for key sk-abc123def456ghi789jklmnopqrs'
            );
            
            expect(result).to.include('[REDACTED_KEY]');
            expect(result).to.not.include('sk-abc123def456ghi789jklmnopqrs');
        });
        
        it('should redact Bearer tokens', function() {
            var result = llmErrorHelper.sanitizeForLogging(
                'Header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
            );
            
            expect(result).to.include('Bearer [REDACTED]');
            expect(result).to.not.include('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
        });
        
        it('should redact x-api-key values', function() {
            var result = llmErrorHelper.sanitizeForLogging(
                'Request headers: x-api-key: my-secret-anthropic-key-12345'
            );
            
            expect(result).to.include('x-api-key: [REDACTED]');
            expect(result).to.not.include('my-secret-anthropic-key-12345');
        });
        
        it('should handle messages with no sensitive data', function() {
            var message = 'Normal log message with no secrets';
            var result = llmErrorHelper.sanitizeForLogging(message);
            
            expect(result).to.equal(message);
        });
        
        it('should redact multiple sensitive values in one message', function() {
            var result = llmErrorHelper.sanitizeForLogging(
                'Key: sk-longapikey12345678901234 with Bearer token123 and x-api-key: secret'
            );
            
            expect(result).to.include('[REDACTED_KEY]');
            expect(result).to.include('Bearer [REDACTED]');
            expect(result).to.include('x-api-key: [REDACTED]');
            expect(result).to.not.include('sk-longapikey12345678901234');
            expect(result).to.not.include('token123');
        });
        
        it('should handle null input', function() {
            var result = llmErrorHelper.sanitizeForLogging(null);
            
            expect(result).to.be.null;
        });
        
        it('should handle undefined input', function() {
            var result = llmErrorHelper.sanitizeForLogging(undefined);
            
            expect(result).to.be.undefined;
        });
        
        it('should handle non-string input', function() {
            var result = llmErrorHelper.sanitizeForLogging(12345);
            
            expect(result).to.equal(12345);
        });
        
        it('should redact X-Goog-Api-Key values', function() {
            var result = llmErrorHelper.sanitizeForLogging(
                'Request headers: X-Goog-Api-Key: AIzaSyTestKey123'
            );
            
            expect(result).to.include('X-Goog-Api-Key: [REDACTED]');
            expect(result).to.not.include('AIzaSyTestKey123');
        });
    });
});
