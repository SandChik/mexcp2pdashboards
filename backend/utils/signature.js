const crypto = require('crypto');

/**
 * MEXC P2P / Spot signature.
 *
 * Per MEXC's official spec: special characters in parameter values must be
 * URL-encoded WHEN SIGNING (uppercase hex only), and `totalParams` is the
 * query string itself. So the rule is: sign the EXACT encoded query string
 * that is transmitted — one identical string for both.
 *
 * encodeURIComponent already produces uppercase percent-encoding (%2C, %0A,
 * %E2%9C%85), which is what MEXC requires. This makes auto-reply / trade-terms
 * text (spaces, newlines, non-ASCII, emoji) and comma-separated filters sign
 * correctly.
 *
 * NOTE: an earlier version signed the raw (un-encoded) string — that only
 * matches for pure-ASCII values and produces "Signature for this request is
 * not valid" the moment a value contains a space, comma, or non-ASCII char.
 */
// encodeURIComponent leaves ! ' ( ) * unescaped, but server-side encoders
// (Java/Python) escape them. Force RFC-3986-strict, uppercase, so the string
// we sign byte-matches what MEXC reconstructs to verify.
function rfc3986(value) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildSignedParams(params, apiSecret) {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };

  const filtered = Object.keys(allParams)
    .filter(key => {
      const v = allParams[key];
      return v !== undefined && v !== null && v !== '';
    })
    .reduce((acc, key) => { acc[key] = allParams[key]; return acc; }, {});

  // The single string that is BOTH signed and sent (encoded, uppercase hex).
  const queryString = Object.keys(filtered)
    .map(key => `${key}=${rfc3986(filtered[key])}`)
    .join('&');

  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');

  return { filtered, queryString, signature };
}

module.exports = { buildSignedParams };
