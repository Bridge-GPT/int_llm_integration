'use strict';

/**
 * LLM Configuration Helper Module
 * 
 * Provides utilities for loading LLM configuration from Site Preferences,
 * parsing the available models JSON, and validating model availability.
 * 
 * @module helpers/llmConfigHelper
 */

var Site = require('dw/system/Site');
var Logger = require('dw/system/Logger');

var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

var logger = Logger.getLogger('LLMIntegration', 'config');

/**
 * Valid LLM providers supported by this cartridge.
 * @constant {Array<string>}
 */
var VALID_PROVIDERS = ['openai', 'anthropic', 'gemini'];

/**
 * Loads LLM configuration values from Site Preferences.
 * 
 * @returns {Object} Configuration object containing:
 *   - llmAvailableModelsJson: The raw JSON string of available models
 *   - llmAnthropicApiVersion: The Anthropic API version header value
 *   - llmDebugMode: Whether debug mode is enabled
 */
function loadLLMConfiguration() {
    var currentSite = Site.getCurrent();
    
    return {
        llmAvailableModelsJson: currentSite.getCustomPreferenceValue('llmAvailableModelsJson'),
        llmAnthropicApiVersion: currentSite.getCustomPreferenceValue('llmAnthropicApiVersion'),
        llmDebugMode: currentSite.getCustomPreferenceValue('llmDebugMode') || false
    };
}

/**
 * Parses the available models JSON string into an object.
 * 
 * @param {string} jsonString - The JSON string to parse
 * @returns {Object} The parsed models configuration object
 * @throws {Error} ConfigurationError if JSON is missing or invalid
 */
function parseAvailableModels(jsonString) {
    if (!jsonString) {
        throw errorHelper.createLLMError(
            'llmAvailableModelsJson preference is not configured',
            errorHelper.ERROR_TYPES.ConfigurationError,
            500,
            null
        );
    }
    
    try {
        var parsed = JSON.parse(jsonString);
        
        // Validate that the parsed object has at least one provider
        var hasProvider = false;
        for (var key in parsed) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                hasProvider = true;
                break;
            }
        }
        
        if (!hasProvider) {
            throw errorHelper.createLLMError(
                'llmAvailableModelsJson must contain at least one provider',
                errorHelper.ERROR_TYPES.ConfigurationError,
                500,
                null
            );
        }
        
        return parsed;
    } catch (e) {
        if (e.isLLMError) {
            throw e;
        }
        
        logger.error('Failed to parse llmAvailableModelsJson: ' + e.message);
        throw errorHelper.createLLMError(
            'llmAvailableModelsJson contains invalid JSON: ' + e.message,
            errorHelper.ERROR_TYPES.ConfigurationError,
            500,
            null
        );
    }
}

/**
 * Gets the available models for a specific provider.
 * 
 * @param {string} provider - The provider name (openai, anthropic, gemini)
 * @returns {Object} Object with tier names as keys and model identifiers as values
 * @throws {Error} ConfigurationError if provider is invalid or configuration is missing
 */
function getAvailableModels(provider) {
    // Validate provider
    if (VALID_PROVIDERS.indexOf(provider) === -1) {
        throw errorHelper.createLLMError(
            'Invalid provider "' + provider + '". Valid providers are: ' + VALID_PROVIDERS.join(', '),
            errorHelper.ERROR_TYPES.ConfigurationError,
            400,
            null
        );
    }
    
    var config = loadLLMConfiguration();
    var models = parseAvailableModels(config.llmAvailableModelsJson);
    
    // Return provider models or empty object if provider not configured
    return models[provider] || {};
}

/**
 * Checks if a specific model is allowed for a given provider.
 * 
 * @param {string} provider - The provider name
 * @param {string} model - The model identifier to check
 * @returns {boolean} True if the model is allowed, false otherwise
 */
function isModelAllowed(provider, model) {
    try {
        var providerModels = getAvailableModels(provider);
        
        // Check if the model exists in any tier
        for (var tier in providerModels) {
            if (Object.prototype.hasOwnProperty.call(providerModels, tier)) {
                if (providerModels[tier] === model) {
                    return true;
                }
            }
        }
        
        return false;
    } catch (e) {
        // If there's a configuration error, log it and return false
        logger.warn('Error checking model availability: ' + e.message);
        return false;
    }
}

/**
 * Gets the Anthropic API version header value.
 * 
 * @returns {string} The Anthropic API version string
 * @throws {Error} ConfigurationError if the version is not configured
 */
function getAnthropicApiVersion() {
    var config = loadLLMConfiguration();
    
    if (!config.llmAnthropicApiVersion) {
        throw errorHelper.createLLMError(
            'llmAnthropicApiVersion preference must be set to use Anthropic provider',
            errorHelper.ERROR_TYPES.ConfigurationError,
            500,
            null
        );
    }
    
    return config.llmAnthropicApiVersion;
}

/**
 * Checks if debug mode is enabled.
 * 
 * @returns {boolean} True if debug mode is enabled
 */
function isDebugMode() {
    var config = loadLLMConfiguration();
    return config.llmDebugMode === true;
}

/**
 * Gets the default LLM model from site preferences.
 *
 * @returns {string} The default model identifier
 * @throws {Error} ConfigurationError if not configured
 */
function getDefaultModel() {
    var currentSite = Site.getCurrent();
    var model = currentSite.getCustomPreferenceValue('llmDefaultModel');

    if (!model) {
        throw errorHelper.createLLMError(
            'llmDefaultModel preference is not configured. Set a default model in Business Manager > Site Preferences > LLM Integration.',
            errorHelper.ERROR_TYPES.ConfigurationError,
            500,
            null
        );
    }

    return model;
}

/**
 * Resolves which provider a model belongs to by reverse-looking it up
 * in the llmAvailableModelsJson configuration.
 *
 * @param {string} model - The model identifier to look up
 * @returns {string} The provider name (openai, anthropic, or gemini)
 * @throws {Error} ConfigurationError if model not found in any provider
 */
function resolveProviderForModel(model) {
    if (!model) {
        throw errorHelper.createLLMError(
            'Model identifier is required to resolve provider',
            errorHelper.ERROR_TYPES.ConfigurationError,
            400,
            null
        );
    }

    var config = loadLLMConfiguration();
    var models = parseAvailableModels(config.llmAvailableModelsJson);

    for (var providerName in models) {
        if (Object.prototype.hasOwnProperty.call(models, providerName)) {
            var tiers = models[providerName];
            for (var tier in tiers) {
                if (Object.prototype.hasOwnProperty.call(tiers, tier)) {
                    if (tiers[tier] === model) {
                        return providerName;
                    }
                }
            }
        }
    }

    throw errorHelper.createLLMError(
        'Model "' + model + '" not found in any provider configuration. Check llmAvailableModelsJson site preference.',
        errorHelper.ERROR_TYPES.ConfigurationError,
        500,
        null
    );
}

/**
 * Gets the system instructions text from site preferences.
 * Returns null if not configured (system instructions are optional).
 *
 * @returns {string|null} The system instructions text, or null if not set
 */
function getSystemInstructions() {
    var currentSite = Site.getCurrent();
    var instructions = currentSite.getCustomPreferenceValue('llmSystemInstructions');
    return instructions || null;
}

module.exports = {
    VALID_PROVIDERS: VALID_PROVIDERS,
    loadLLMConfiguration: loadLLMConfiguration,
    parseAvailableModels: parseAvailableModels,
    getAvailableModels: getAvailableModels,
    isModelAllowed: isModelAllowed,
    getAnthropicApiVersion: getAnthropicApiVersion,
    isDebugMode: isDebugMode,
    getDefaultModel: getDefaultModel,
    resolveProviderForModel: resolveProviderForModel,
    getSystemInstructions: getSystemInstructions
};
