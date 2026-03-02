'use strict';

/**
 * LLM OpenAI Batch Service Module
 *
 * Implements the SFCC service definition for OpenAI's Batch API.
 * Handles the two-step submission (file upload + batch creation),
 * status polling, JSONL result retrieval, and cancellation.
 *
 * @module services/llmOpenAIBatchService
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');

var logger = Logger.getLogger('LLMIntegration', 'openai-batch');

/**
 * Service ID constant matching the service-id in services.xml.
 * @constant {string}
 */
var SERVICE_ID = 'llm.openai.batch';

/**
 * Generates a unique multipart boundary string.
 *
 * @returns {string} A boundary string
 * @private
 */
function generateBoundary() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var suffix = '';
    for (var i = 0; i < 16; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return '----LLMBatchBoundary' + Date.now() + suffix;
}

/**
 * Builds a multipart/form-data body string.
 *
 * @param {string} boundary - The multipart boundary
 * @param {string} jsonlContent - The JSONL content for the batch file
 * @returns {string} The multipart body
 * @private
 */
function buildMultipartBody(boundary, jsonlContent) {
    return '--' + boundary + '\r\n'
        + 'Content-Disposition: form-data; name="purpose"\r\n\r\n'
        + 'batch\r\n'
        + '--' + boundary + '\r\n'
        + 'Content-Disposition: form-data; name="file"; filename="batch.jsonl"\r\n'
        + 'Content-Type: application/jsonl\r\n\r\n'
        + jsonlContent + '\r\n'
        + '--' + boundary + '--\r\n';
}

/**
 * Parses a JSONL response text into an array of objects.
 * Each line is parsed individually; malformed lines produce error entries.
 *
 * @param {string} responseText - The JSONL text
 * @returns {Array} Array of parsed objects or error entries
 * @private
 */
function parseJSONL(responseText) {
    var lines = responseText.split('\n');
    var results = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) {
            try {
                results.push(JSON.parse(line));
            } catch (e) {
                results.push({ parseError: true, rawLine: line, error: e.message });
            }
        }
    }
    return results;
}

/**
 * Submits a batch of requests to OpenAI via two-step process:
 * 1. Upload JSONL file via POST /v1/files
 * 2. Create batch via POST /v1/batches
 *
 * @param {string} model - The model identifier
 * @param {Array} items - Array of { customId, payload } objects
 * @returns {Object} Batch submission result
 * @throws {Error} BatchSubmissionError or ConfigurationError
 */
function submitBatch(model, items) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

    // Build JSONL content
    var jsonlLines = [];
    for (var i = 0; i < items.length; i++) {
        jsonlLines.push(JSON.stringify({
            custom_id: items[i].customId,
            method: 'POST',
            url: '/v1/chat/completions',
            body: items[i].payload
        }));
    }
    var jsonlContent = jsonlLines.join('\n');

    // Generate boundary and build multipart body
    var boundary = generateBoundary();
    var multipartBody = buildMultipartBody(boundary, jsonlContent);

    // Step 1: File Upload
    var uploadService = LocalServiceRegistry.createService(SERVICE_ID, {
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
                    'OpenAI API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = credential.getURL() || 'https://api.openai.com';
            svc.setURL(baseUrl + '/v1/files');
            svc.setRequestMethod('POST');

            svc.addHeader('Authorization', 'Bearer ' + apiKey);
            svc.addHeader('Content-Type', 'multipart/form-data; boundary=' + params.boundary);

            return params.body;
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('openai', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: 'file-mock-' + Date.now(),
                    object: 'file',
                    purpose: 'batch',
                    filename: 'batch.jsonl'
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var uploadResult = uploadService.call({ body: multipartBody, boundary: boundary });

    if (!uploadResult.ok) {
        var uploadErrorMsg = 'OpenAI batch file upload failed';
        if (uploadResult.errorMessage) {
            uploadErrorMsg += ': ' + uploadResult.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(uploadErrorMsg));

        if (uploadResult.error && uploadResult.error.isLLMError) {
            throw uploadResult.error;
        }

        throw errorHelper.createLLMError(
            uploadErrorMsg,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    var fileId = uploadResult.object.id;

    // Step 2: Batch Creation
    var batchService = LocalServiceRegistry.createService(SERVICE_ID, {
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
                    'OpenAI API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = credential.getURL() || 'https://api.openai.com';
            svc.setURL(baseUrl + '/v1/batches');
            svc.setRequestMethod('POST');

            svc.addHeader('Authorization', 'Bearer ' + apiKey);
            svc.addHeader('Content-Type', 'application/json');

            return JSON.stringify({
                input_file_id: params.fileId,
                endpoint: '/v1/chat/completions',
                completion_window: '24h'
            });
        },

        parseResponse: function (svc, client) {
            if (client.statusCode !== 200) {
                var errorBody = null;
                try {
                    errorBody = JSON.parse(client.text);
                } catch (e) {
                    errorBody = { message: client.text };
                }
                throw errorHelper.mapProviderError('openai', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: 'batch_mock_' + Date.now(),
                    object: 'batch',
                    endpoint: '/v1/chat/completions',
                    status: 'validating',
                    request_counts: {
                        total: params.totalRequests,
                        completed: 0,
                        failed: 0
                    },
                    created_at: Math.floor(Date.now() / 1000)
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var batchResult = batchService.call({ fileId: fileId, totalRequests: items.length });

    if (!batchResult.ok) {
        var batchErrorMsg = 'OpenAI batch creation failed';
        if (batchResult.errorMessage) {
            batchErrorMsg += ': ' + batchResult.errorMessage;
        }
        logger.error(errorHelper.sanitizeForLogging(batchErrorMsg));

        if (batchResult.error && batchResult.error.isLLMError) {
            throw batchResult.error;
        }

        throw errorHelper.createLLMError(
            batchErrorMsg,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    return {
        batchId: batchResult.object.id,
        status: batchResult.object.status,
        requestCounts: batchResult.object.request_counts,
        createdAt: batchResult.object.created_at
    };
}

/**
 * Gets the status of an OpenAI batch.
 *
 * @param {string} batchId - The batch identifier
 * @returns {Object} Batch status with unified status string
 * @throws {Error} ProviderError on failure
 */
function getBatchStatus(batchId) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');

    var STATUS_MAP = {
        validating: 'pending',
        in_progress: 'processing',
        finalizing: 'processing',
        completed: 'completed',
        failed: 'failed',
        expired: 'expired',
        cancelling: 'cancelling',
        cancelled: 'cancelled'
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
                    'OpenAI API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = credential.getURL() || 'https://api.openai.com';
            svc.setURL(baseUrl + '/v1/batches/' + params.batchId);
            svc.setRequestMethod('GET');

            svc.addHeader('Authorization', 'Bearer ' + apiKey);

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
                throw errorHelper.mapProviderError('openai', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: params.batchId,
                    object: 'batch',
                    status: 'completed',
                    request_counts: { total: 5, completed: 5, failed: 0 },
                    created_at: Math.floor(Date.now() / 1000),
                    expires_at: Math.floor(Date.now() / 1000) + 86400,
                    output_file_id: 'file-output-mock'
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId });

    if (!result.ok) {
        var errorMessage = 'OpenAI batch status check failed';
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

    var unifiedStatus = STATUS_MAP[result.object.status] || 'processing';

    return {
        batchId: batchId,
        status: unifiedStatus,
        requestCounts: {
            total: result.object.request_counts.total,
            completed: result.object.request_counts.completed,
            failed: result.object.request_counts.failed
        },
        createdAt: result.object.created_at,
        expiresAt: result.object.expires_at || null,
        outputFileId: result.object.output_file_id || null
    };
}

/**
 * Retrieves and parses the results of a completed OpenAI batch.
 *
 * @param {string} batchId - The batch identifier
 * @param {string} model - The model used for normalization
 * @returns {Array} Array of { customId, success, response, error } items
 * @throws {Error} BatchSubmissionError if batch not complete, ProviderError on failure
 */
function getBatchResults(batchId, model) {
    var errorHelper = require('*/cartridge/scripts/helpers/llmErrorHelper');
    var normalizationHelper = require('*/cartridge/scripts/helpers/llmNormalizationHelper');

    // First get status to find output file ID
    var statusResult = getBatchStatus(batchId);

    if (statusResult.status !== 'completed' && statusResult.status !== 'failed') {
        throw errorHelper.createLLMError(
            'Batch is not yet complete. Current status: ' + statusResult.status,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    if (!statusResult.outputFileId) {
        throw errorHelper.createLLMError(
            'No output file available for batch ' + batchId,
            errorHelper.ERROR_TYPES.BatchSubmissionError,
            500,
            null
        );
    }

    // Download results file
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
                    'OpenAI API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = credential.getURL() || 'https://api.openai.com';
            svc.setURL(baseUrl + '/v1/files/' + params.outputFileId + '/content');
            svc.setRequestMethod('GET');

            svc.addHeader('Authorization', 'Bearer ' + apiKey);

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
                throw errorHelper.mapProviderError('openai', client.statusCode, errorBody);
            }

            // Return raw JSONL text, not parsed JSON
            return client.text;
        },

        mockCall: function (svc, params) {
            var successLine = JSON.stringify({
                custom_id: 'r1',
                response: {
                    status_code: 200,
                    body: {
                        id: 'chatcmpl-mock',
                        choices: [{ message: { content: 'Mock response' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                    }
                }
            });
            var errorLine = JSON.stringify({
                custom_id: 'r2',
                response: {
                    status_code: 429,
                    body: { error: { message: 'Rate limited' } }
                }
            });
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: successLine + '\n' + errorLine
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ outputFileId: statusResult.outputFileId });

    if (!result.ok) {
        var errorMessage = 'OpenAI batch results download failed';
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

    // Parse JSONL results
    var parsedLines = parseJSONL(result.object);
    var results = [];

    for (var i = 0; i < parsedLines.length; i++) {
        var line = parsedLines[i];

        if (line.parseError) {
            results.push({
                customId: 'unknown',
                success: false,
                error: errorHelper.createLLMError(
                    'Failed to parse result line: ' + line.error,
                    errorHelper.ERROR_TYPES.ProviderError,
                    500,
                    null
                )
            });
        } else if (line.response && line.response.status_code === 200) {
            var normalizedResponse = normalizationHelper.normalizeOpenAIResponse(line.response.body, model);
            normalizedResponse.rawResponse = line.response.body;
            results.push({
                customId: line.custom_id,
                success: true,
                response: normalizedResponse
            });
        } else {
            results.push({
                customId: line.custom_id,
                success: false,
                error: errorHelper.mapProviderError('openai', line.response.status_code, line.response.body)
            });
        }
    }

    return results;
}

/**
 * Cancels an OpenAI batch.
 *
 * @param {string} batchId - The batch identifier
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
                    'OpenAI API key not configured in service credential',
                    errorHelper.ERROR_TYPES.ConfigurationError,
                    500,
                    null
                );
            }

            var baseUrl = credential.getURL() || 'https://api.openai.com';
            svc.setURL(baseUrl + '/v1/batches/' + params.batchId + '/cancel');
            svc.setRequestMethod('POST');

            svc.addHeader('Authorization', 'Bearer ' + apiKey);

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
                throw errorHelper.mapProviderError('openai', client.statusCode, errorBody);
            }

            return JSON.parse(client.text);
        },

        mockCall: function (svc, params) {
            return {
                statusCode: 200,
                statusMessage: 'OK',
                text: JSON.stringify({
                    id: params.batchId,
                    object: 'batch',
                    status: 'cancelling'
                })
            };
        },

        filterLogMessage: function (msg) {
            return errorHelper.sanitizeForLogging(msg);
        }
    });

    var result = service.call({ batchId: batchId });

    if (!result.ok) {
        var errorMessage = 'OpenAI batch cancellation failed';
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
