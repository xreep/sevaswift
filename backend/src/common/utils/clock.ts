export interface Clock {
  now: () => number;
}

let clock: Clock = {
  now: () => Date.now(),
};

export function setClock(customClock: Clock): void {
  clock = customClock;
}

export function getClock(): Clock {
  return clock;
}

export function now(): number {
  return clock.now();
}

export function nowISO(): string {
  return new Date(clock.now()).toISOString();
}