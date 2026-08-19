export function logInfo(category, message, extra = '') {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${category}] ${message} ${extra ? (typeof extra === 'object' ? JSON.stringify(extra) : extra) : ''}`);
}

export function logError(category, message, error = null) {
  const time = new Date().toLocaleTimeString();
  console.error(`[${time}] ❌ [${category}] ${message}`, error ? (error.message || error) : '');
}
