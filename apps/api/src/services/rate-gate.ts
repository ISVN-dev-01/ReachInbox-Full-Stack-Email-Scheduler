import { redis } from '../config/clients';
import { env } from '../config/env';
// Redis TIME is authoritative across workers. A lease serializes SMTP calls; quota is
// reserved only when the lease, time gate, and both hourly budgets permit sending.
export const gateScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = math.floor(now / 3600000)
local nextHour = (window + 1) * 3600000
local hourly = KEYS[1] .. ':hour:' .. window
local campaignHourly = KEYS[2] .. ':hour:' .. window
local count = tonumber(redis.call('GET', hourly) or '0')
local campaignCount = tonumber(redis.call('GET', campaignHourly) or '0')
if count >= tonumber(ARGV[1]) or campaignCount >= tonumber(ARGV[2]) then
  return {0, nextHour, window, 1, count, campaignCount}
end
local lease = redis.call('PTTL', KEYS[1] .. ':lease')
local nextAt = tonumber(redis.call('GET', KEYS[1] .. ':next') or '0')
if lease > 0 then return {0, math.max(now + lease, nextAt), window, 0, count, campaignCount} end
if nextAt > now then return {0, nextAt, window, 0, count, campaignCount} end
redis.call('SET', KEYS[1] .. ':lease', ARGV[4], 'PX', ARGV[5])
redis.call('SET', KEYS[1] .. ':next', now + tonumber(ARGV[3]), 'PX', math.max(tonumber(ARGV[3]) + tonumber(ARGV[5]), 3600000))
redis.call('INCR', hourly)
redis.call('PEXPIREAT', hourly, nextHour + 3600000)
redis.call('INCR', campaignHourly)
redis.call('PEXPIREAT', campaignHourly, nextHour + 3600000)
return {1, now, window, 0, count + 1, campaignCount + 1}
`;
export const releaseScript = `
if redis.call('GET', KEYS[1] .. ':lease') ~= ARGV[1] then return 0 end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('SET', KEYS[1] .. ':next', now + tonumber(ARGV[2]), 'PX', math.max(tonumber(ARGV[2]) + 60000, 3600000))
redis.call('DEL', KEYS[1] .. ':lease')
return 1
`;
export async function acquireGate(
  senderId: string,
  campaignId: string,
  senderLimit: number,
  campaignLimit: number,
  delay: number,
  token: string,
) {
  const result = (await redis.eval(
    gateScript,
    2,
    `gate:{${senderId}}`,
    `gate:{${senderId}}:campaign:${campaignId}`,
    senderLimit,
    campaignLimit,
    delay,
    token,
    env.SENDER_LEASE_MS,
  )) as number[];
  return {
    allowed: result[0] === 1,
    nextAt: result[1]!,
    window: result[2]!,
    limited: result[3] === 1,
    count: result[4]!,
    campaignCount: result[5]!,
  };
}
export async function releaseGate(senderId: string, token: string, delay: number) {
  await redis.eval(releaseScript, 1, `gate:{${senderId}}`, token, delay);
}
