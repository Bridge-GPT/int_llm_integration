'use strict';

/**
 * LLM Gemini Batch Service Module
 *
 * Implements the SFCC service definition for Google Gemini's Batch API
 * using the native v1beta batch endpoint with inline request/response format.
 *
 * NOTE: This uses the v1beta API which may change. All Gemini batch-specific
 * logic is isolated in this single file so API changes require modifying
 * only one module.
 *
 * @module services/llmGeminiBatchService
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');

var logger = Logger.getLogger('LLMIntegration', 'gemini-batch');

/**
 * Service ID constant matching the service-id in services.xml.
 * @constant {string}
 */
var SERVICE_ID = 'llm.gemini.batch';

/**
 * Default Gemini base URL (without versioned path).
 * @constant {string}
 */
var DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Maps Gemini job states to unified batch status strings.
 * @constant {Object}
 */
var STATUS_MAP = {
    JOB_STATE_PENDING: 'pending',
    JOB_STATE_RUNNING: 'processing',
    JOB_STATE_SUCCEEDED: 'completed',
    JOB_STATE_FAILED: 'failed',
    JOB_STATE_CANCELLED: 'cancelled',
    JOB_STATE_EXPIRED: 'expired'
};

/**
 * Extracts the bare host URL from a credential URL that may include path segments.
 * The sync Gemini credential URL is typically:
 *   https://generativelanguage.googleapis.com/v1beta/models
 * Batch operations need both /v1beta/models/... and /v1beta/batches/... paths,
 * so we strip down to just the host.
 *
 * @param {string} credentialUrl - URL from service credential
 * @returns {string} Base URL with host only (e.g., 'https://generativelanguage.googleapis.com')
 */
function getBaseHostUrl(credentialUrl) {
    var url = credentialUrl || DEFAULT_BASE_URL;
    // Strip any path segments — keep only scheme + host
    var match = url.match(/^(https?:\/\/[^/]+)/);
    return match ? match[1] : DEFAULT_BASE_URL;
}

/**
 * Submits a batch of requests to Gemini.
 *
 * @param {string} model - The model identifier
 * @param {Array} items - Array of { customId, payload } objects
 * @returns {Object} Batch submission result
 * @throws {Error} BatchSubmissionError or ConfigurationError
 */
function submitBatch(model, items) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

    // Build request body per Gemini batch API format
    // Docs: https://ai.google.dev/api/batch-api
    var inlinedRequests = [];
    for (var i = 0; i < items.length; i++) {
        inlinedRequests.push({
            request: items[i].payload,
            metadata: { key: items[i].customId }
        });
    }
    var requestBody = {
        batch: {
            input_config: {
                requests: {
                    requests: inlinedRequests
                }
            }
        }
    };

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
        createRequest: function (svc, params) {
            var credential = svc.getConfiguration().getCredential();

            if (!credential) {
                throw errorHelper.createLLMError(
                    'Service credential not configured for ' + SERVICE_ID,
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var apiKey = credential.getPassword();

            if (!apiKey) {
                throw errorHelper.createLLMError(
                    'Gemini API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = getBaseHostUrl(credential.getURL());
            var fullUrl = baseUrl + '/v1beta/models/' + params.model + ':batchGenerateContent';

            svc.setURL(fullUrl);
            svc.setRequestMethod('POST');

            svc.addHeader('X-Goog-Api-Key', apiKey);
            svc.addHeader('Content-Type', 'application/json');

            return JSON.stringify(params.body);
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('gemini', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            var reqCount = params.body.batch.input_config.requests.requests.length;
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    name: 'batches/mock-' + Date.now(),
                    state: 'JOB_STATE_PENDING',
                    batchStats: {
                        requestCount: reqCount,
                        successfulRequestCount: 0,
                        failedRequestCount: 0,
                        pendingRequestCount: reqCount
                    }
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ body: requestBody, model: model });

    if (!result.ok) {
        var errorMessage = 'Gemini batch submission failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    return {
        batchId: result.object.name,
        status: STATUS_MAP[result.object.state] || 'pending',
        requestCounts: {
            total: (result.object.batchStats && result.object.batchStats.requestCount) || items.length,
            completed: (result.object.batchStats && result.object.batchStats.successfulRequestCount) || 0,
            failed: (result.object.batchStats && result.object.batchStats.failedRequestCount) || 0
        },
        createdAt: result.object.createTime || null
    };
}

/**
 * Gets the status of a Gemini batch.
 *
 * @param {string} batchId - The batch identifier (full resource name, e.g., 'batches/abc123')
 * @returns {Object} Batch status with unified status string
 * @throws {Error} ProviderError on failure
 */
function getBatchStatus(batchId) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
        createRequest: function (svc, params) {
            var credential = svc.getConfiguration().getCredential();

            if (!credential) {
                throw errorHelper.createLLMError(
                    'Service credential not configured for ' + SERVICE_ID,
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var apiKey = credential.getPassword();

            if (!apiKey) {
                throw errorHelper.createLLMError(
                    'Gemini API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = getBaseHostUrl(credential.getURL());
            svc.setURL(baseUrl + '/v1beta/' + params.batchId);
            svc.setRequestMethod('GET');

            svc.addHeader('X-Goog-Api-Key', apiKey);

            return null;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('gemini', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    name: params.batchId,
                    state: 'JOB_STATE_SUCCEEDED',
                    batchStats: {
                        requestCount: 5,
                        successfulRequestCount: 5,
                        failedRequestCount: 0,
                        pendingRequestCount: 0
                    },
                    createTime: new Date().toISOString(),
                    response: {
                        inlinedResponses: []
                    }
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId });

    if (!result.ok) {
        var errorMessage = 'Gemini batch status check failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }

    var unifiedStatus = STATUS_MAP[result.object.state] || 'processing';
    var stats = result.object.batchStats || {};

    return {
        batchId: batchId,
        status: unifiedStatus,
        requestCounts: {
            total: stats.requestCount || 0,
            completed: stats.successfulRequestCount || 0,
            failed: stats.failedRequestCount || 0
        },
        createdAt: result.object.createTime || null,
        expiresAt: null
    };
}

/**
 * Retrieves and parses the results of a completed Gemini batch.
 * Gemini embeds results inline in the batch resource response.
 *
 * @param {string} batchId - The batch identifier (full resource name)
 * @param {string} model - The model used for normalization
 * @returns {Array} Array of { customId, success, response, error } items
 * @throws {Error} BatchSubmissionError if batch not complete, ProviderError on failure
 */
function getBatchResults(batchId, model) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');

    // Gemini embeds results inline - fetch the full batch resource
    var service = LocalServiceRegistry.createService(SERVICE_ID, {
        createRequest: function (svc, params) {
            var credential = svc.getConfiguration().getCredential();

            if (!credential) {
                throw errorHelper.createLLMError(
                    'Service credential not configured for ' + SERVICE_ID,
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var apiKey = credential.getPassword();

            if (!apiKey) {
                throw errorHelper.createLLMError(
                    'Gemini API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = getBaseHostUrl(credential.getURL());
            svc.setURL(baseUrl + '/v1beta/' + params.batchId);
            svc.setRequestMethod('GET');

            svc.addHeader('X-Goog-Api-Key', apiKey);

            return null;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('gemini', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    name: params.batchId,
                    state: 'JOB_STATE_SUCCEEDED',
                    batchStats: {
                        requestCount: 2,
                        successfulRequestCount: 1,
                        failedRequestCount: 1
                    },
                    response: {
                        inlinedResponses: [
                            {
                                metadata: { key: 'r1' },
                                response: {
                                    candidates: [{
                                        content: { parts: [{ text: 'Mock response' }], role: 'model' },
                                        finishReason: 'STOP'
                                    }],
                                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
                                }
                            },
                            {
                                metadata: { key: 'r2' },
                                error: { code: 500, message: 'Internal error' }
                            }
                        ]
                    }
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId });

    if (!result.ok) {
        var errorMessage = 'Gemini batch results retrieval failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }

    // Check batch is in a terminal state
    if (result.object.state !== 'JOB_STATE_SUCCEEDED' && result.object.state !== 'JOB_STATE_FAILED') {
        throw errorHelper.createLLMError(
            'Batch is not yet complete. Current state: ' + result.object.state,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    var inlinedResponses = (result.object.response && result.object.response.inlinedResponses) || [];
    var results = [];

    for (var i = 0; i < inlinedResponses.length; i++) {
        var item = inlinedResponses[i];
        var customId = (item.metadata && item.metadata.key) || 'unknown';

        if (item.response) {
            var normalizedResponse = normalizationHelper.normalizeGeminiResponse(item.response, model);
            normalizedResponse.rawResponse = item.response;
            results.push({
                customId: customId,
                success: true,
                response: normalizedResponse
            });
        } else if (item.error) {
            results.push({
                customId: customId,
                success: false,
                error: errorHelper.createLLMError(
                    'Gemini batch item error: ' + (item.error.message || 'Unknown error'),
                    errorHelper.ERROR_TYPES.ProviderError,
                    item.error.code || 500,
                    item.error
                )
            });
        }
    }

    return results;
}

/**
 * Cancels a Gemini batch.
 *
 * @param {string} batchId - The batch identifier (full resource name)
 * @returns {Object} Cancellation result with batchId and status
 * @throws {Error} ProviderError on failure
 */
function cancelBatch(batchId) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

    var service = LocalServiceRegistry.createService(SERVICE_ID, {
        createRequest: function (svc, params) {
            var credential = svc.getConfiguration().getCredential();

            if (!credential) {
                throw errorHelper.createLLMError(
                    'Service credential not configured for ' + SERVICE_ID,
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var apiKey = credential.getPassword();

            if (!apiKey) {
                throw errorHelper.createLLMError(
                    'Gemini API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = getBaseHostUrl(credential.getURL());
            svc.setURL(baseUrl + '/v1beta/' + params.batchId + ':cancel');
            svc.setRequestMethod('POST');

            svc.addHeader('X-Goog-Api-Key', apiKey);

            return null;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('gemini', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    name: params.batchId,
                    state: 'JOB_STATE_CANCELLED'
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId });

    if (!result.ok) {
        var errorMessage = 'Gemini batch cancellation failed';
        if (result.errorMessage) {
            errorMessage += ': ' + result.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(errorMessage));

        if (result.error && result.error.isLLMError) {
            throw result.error;
        }

        throw errorHelper.createLLMError(
            errorMessage,
            errorHelper.ERROR_TYPES.ProviderError,
            500,
            null
        );
    }

    return {
        batchId: batchId,
        status: 'cancelling'
    };
}

module.exports = {
    submitBatch: submitBatch,
    getBatchStatus: getBatchStatus,
    getBatchResults: getBatchResults,
    cancelBatch: cancelBatch,
    SERVICE_ID: SERVICE_ID
};
