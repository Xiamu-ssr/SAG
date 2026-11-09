export const minSpeed = 0.1;
export const maxSpeed = 10;

export function isWorldSpeed(value: unknown): value is number {
  return typeof value === "number" && value >= minSpeed && value <= maxSpeed;
}

export function worldRate(speed: number) {
  return speed * 0.5;
}
