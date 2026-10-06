// Wraps an async route handler so rejections reach Express error middleware
// instead of hanging the request (Express 4 does not forward async errors).
export function ah(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
