export const RESERVATION_MICRO_USD = 70_000;
export const BUDGET_MICRO_USD = 5_000_000;
export const BUDGET_KEY = "shiftsc:privacy:budget:v1";

export const RESERVE_LUA = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local ceiling = tonumber(ARGV[2])
if used + amount > ceiling then return -1 end
redis.call('INCRBY', KEYS[1], amount)
return ceiling - used - amount
`;

export const RATE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 120) end
return count
`;

export async function redisCommand(command, env = process.env, fetchImpl = fetch) {
  const url = new URL(env.UPSTASH_REDIS_REST_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error("Invalid storage configuration");
  const response = await fetchImpl(env.UPSTASH_REDIS_REST_URL, {
    method: "POST", signal: AbortSignal.timeout(5000), redirect: "error",
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error("Budget storage unavailable");
  const result = await response.json();
  if (!result || result.error || !Object.hasOwn(result, "result")) throw new Error("Budget storage unavailable");
  return result.result;
}
