import type {
  EngineEvent,
  EngineMessage,
} from "@agent-native/core/agent/engine";
import {
  classifyProviderError,
  describeErrorWithCauses,
  isContextOverflowCode,
  isContextOverflowMessage,
  isCreditsLimitErrorCode,
  isInvalidAttachmentProviderMessage,
} from "@agent-native/core/agent/engine/error-detail";
import { PROVIDER_ENV_VARS } from "@agent-native/core/agent/engine/provider-env-vars";
import { builderSubscriptionUpgradeUrl } from "@agent-native/core/shared/builder-link-tracking";

type ProviderStop = Extract<EngineEvent, { type: "stop" }>;
const credentialKeys = [
  ...PROVIDER_ENV_VARS,
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
];
const credentialsMessage =
  "The model provider needs a valid connection. Check Settings > Agent > AI providers.";
const genericMessage = "The model provider could not complete this reply.";

const providerRecoveryCodes = new Set([
  "authentication_error",
  "billing_error",
  "builder_auth_error",
  "builder_model_unauthorized",
  "builder_gateway_error",
  "builder_gateway_internal_error",
  "builder_gateway_network_error",
  "builder_gateway_stream_ended",
  "builder_gateway_timeout",
  "builder_oauth_lookup_failed",
  "builder_oauth_refresh_failed",
  "context_length_exceeded",
  "credential_store_unavailable",
  "gateway_not_enabled",
  "input_too_long",
  "invalid_api_key",
  "invalid_attachment",
  "invalid_request",
  "invalid_request_error",
  "missing_api_key",
  "missing_credentials",
  "model_not_found",
  "not_found_error",
  "overloaded_error",
  "permission_error",
  "provider_config_error",
  "provider_internal_error",
  "provider_network_error",
  "provider_rate_limited",
  "provider_transient_rejection",
  "rate_limit_exceeded",
  "rate_limited",
  "request_too_large",
  "timeout",
  "too_many_concurrent_requests",
  "unauthorized",
]);

function knownProviderCode(code: string | undefined) {
  if (typeof code !== "string") return;
  const normalized = code.trim().toLowerCase();
  if (
    providerRecoveryCodes.has(normalized) ||
    /^http_[45]\d{2}$/.test(normalized)
  )
    return normalized;
  if (isCreditsLimitErrorCode(normalized)) return "credits-limit";
}

export function safeProviderFailure(
  failure: unknown,
  messages: EngineMessage[],
  stop?: ProviderStop,
): ProviderStop {
  const message =
    stop?.error ?? (failure == null ? "" : describeErrorWithCauses(failure));
  const lower = message.toLowerCase();
  const structured = stop ?? (failure as Partial<ProviderStop> | undefined);
  const classified = classifyProviderError(
    stop ? Object.assign(new Error(message), stop) : failure,
  );
  const status = structured?.statusCode ?? classified.statusCode;
  const statusCode =
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? status
      : undefined;
  const explicitCode = structured?.errorCode;
  const hasInlineAttachment = messages.some(({ content }) =>
    content.some(
      (part) =>
        part.type === "image" ||
        part.type === "file" ||
        (part.type === "tool-result" && Boolean(part.images?.length)),
    ),
  );
  const attachmentRejected =
    explicitCode === "invalid_attachment" ||
    (hasInlineAttachment &&
      (statusCode === 413 ||
        ((statusCode === undefined ||
          statusCode === 400 ||
          statusCode === 422) &&
          isInvalidAttachmentProviderMessage(message))));
  const contextOverflow =
    !attachmentRejected &&
    (structured?.contextOverflow === true ||
      isContextOverflowCode(explicitCode) ||
      isContextOverflowMessage(message));
  const missingCredentials =
    !explicitCode &&
    (credentialKeys.some((key) => message.includes(key)) ||
      /\b(?:llm|model provider|ai engine)\b.*\b(?:missing|not set|not configured|required|not connected|api\s*key|credentials?)\b/i.test(
        message,
      ) ||
      /\b(?:missing|not set|not configured|required|not connected|api\s*key|credentials?)\b.*\b(?:llm|model provider|ai engine)\b/i.test(
        message,
      ));
  const transportFailure =
    /fetch failed|network error|connection (?:closed|reset)|stream closed|econnaborted|enetreset|terminated/.test(
      lower,
    );
  const dailyCap = lower.includes("daily gateway request cap");
  let errorCode =
    knownProviderCode(explicitCode) ?? knownProviderCode(classified.errorCode);
  if (attachmentRejected) errorCode = "invalid_attachment";
  else if (!errorCode && missingCredentials) errorCode = "missing_credentials";
  else if (!errorCode && dailyCap) errorCode = "rate_limit_exceeded";
  else if (!errorCode && transportFailure) errorCode = "provider_network_error";

  const retryable =
    attachmentRejected || dailyCap
      ? false
      : (structured?.providerRetryable ?? classified.providerRetryable);
  const delay = structured?.retryAfterMs ?? classified.retryAfterMs;
  const retryAfterMs =
    typeof delay === "number" && Number.isFinite(delay) && delay >= 0
      ? delay
      : undefined;
  const normalizedCode = errorCode?.toLowerCase() ?? "";
  const rejectedCredential =
    /^(?:http_40[13]|authentication_error|unauthorized)$/.test(normalizedCode);
  const builderReconnect =
    normalizedCode === "builder_auth_error" ||
    lower.includes("builder authentication failed") ||
    (rejectedCredential && /invalid token|personal access token/.test(lower));
  let error = genericMessage;
  if (attachmentRejected)
    error = "The model provider rejected an attachment in this request.";
  else if (contextOverflow)
    error =
      "The model provider could not fit this conversation in its context.";
  else if (builderReconnect)
    error =
      "Builder authentication failed. Reconnect Builder in Settings > Agent > AI providers.";
  else if (
    rejectedCredential ||
    /^(?:missing_(?:api_key|credentials)|invalid_api_key)$/.test(normalizedCode)
  )
    error = credentialsMessage;
  else if (dailyCap) error = "The daily gateway request cap was reached.";
  else if (/(?:gateway|upstream|function) timeout/.test(lower))
    error = "The model provider reported a gateway timeout.";
  const upgradeUrl =
    structured?.upgradeUrl && isCreditsLimitErrorCode(errorCode)
      ? builderSubscriptionUpgradeUrl("gateway_quota_upgrade")
      : undefined;

  return {
    type: "stop",
    reason: "error",
    error,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(retryable === undefined ? {} : { providerRetryable: retryable }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    contextOverflow,
    ...(upgradeUrl === undefined ? {} : { upgradeUrl }),
  };
}
