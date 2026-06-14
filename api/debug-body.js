module.exports = async (req, res) => {
  const info = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    contentType: req.headers['content-type'],
    bodyType: typeof req.body,
    bodyIsNull: req.body === null,
    bodyIsUndefined: req.body === undefined,
    bodyStr: req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body).slice(0,200)) : 'null/undefined',
    hasRawBody: 'rawBody' in req,
    rawBodyType: typeof req.rawBody,
    rawBodyLen: req.rawBody ? req.rawBody.length : 0,
    readableEnded: req.readableEnded,
    complete: req.complete,
    aborted: req.aborted,
    keysWithBody: Object.keys(req).filter(k => k.toLowerCase().includes('body') || k.toLowerCase().includes('raw')),
    keysAll: Object.keys(req).filter(k => !k.startsWith('_')),
  };
  res.status(200).json(info);
};
