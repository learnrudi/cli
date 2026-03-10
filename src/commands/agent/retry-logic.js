export function createRetryState() {
  return {
    count: 0,
    maxRetries: 3,
    delays: [1000, 2000, 4000]
  };
}

export function canRetry(state) {
  return state.count < state.maxRetries;
}

export function getNextDelay(state) {
  return state.delays[state.count] || state.delays[state.delays.length - 1];
}

export function incrementRetry(state) {
  state.count++;
}

export function resetRetry(state) {
  state.count = 0;
}
