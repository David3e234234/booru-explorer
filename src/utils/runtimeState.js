let runtimePort = null;

export function setRuntimePort(port) {
  runtimePort = Number(port) || null;
}

export function getRuntimePort() {
  return runtimePort;
}
