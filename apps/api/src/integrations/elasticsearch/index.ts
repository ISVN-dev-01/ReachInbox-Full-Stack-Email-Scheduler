import { errors } from '@elastic/elasticsearch';
import { db, elastic } from '../../config/clients';
import { env } from '../../config/env';
import { paginated } from '../../repositories/emails';
import { AppError } from '../../utils/errors';
export async function ensureIndex() {
  if (await elastic.indices.exists({ index: env.ELASTICSEARCH_INDEX })) return;
  try {
    await elastic.indices.create({
      index: env.ELASTICSEARCH_INDEX,
      mappings: {
        dynamic: 'strict',
        properties: {
          id: { type: 'keyword' },
          userId: { type: 'keyword' },
          campaignId: { type: 'keyword' },
          senderId: { type: 'keyword' },
          recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          subject: { type: 'text' },
          status: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          nextAttemptAt: { type: 'date' },
          sentAt: { type: 'date' },
          createdAt: { type: 'date' },
        },
      },
    });
  } catch (error) {
    if (!(
      error instanceof errors.ResponseError &&
      error.body?.error?.type === 'resource_already_exists_exception'
    ))
      throw error;
  }
}
export async function indexEmail(id: string) {
  const email = await db.email.findUnique({ where: { id } });
  if (!email) return;
  const {
    userId,
    campaignId,
    senderId,
    recipient,
    subject,
    status,
    scheduledAt,
    nextAttemptAt,
    sentAt,
    createdAt,
    revision,
  } = email;
  try {
    await elastic.index({
      index: env.ELASTICSEARCH_INDEX,
      id,
      version: revision,
      version_type: 'external_gte',
      document: {
        id,
        userId,
        campaignId,
        senderId,
        recipient,
        subject,
        status,
        scheduledAt,
        nextAttemptAt,
        sentAt,
        createdAt,
      },
    });
  } catch (error) {
    if (!(error instanceof errors.ResponseError && error.statusCode === 409)) throw error;
  }
}
export async function searchEmails(
  userId: string,
  q: string,
  status: string,
  campaignId: string | undefined,
  page: number,
  limit: number,
) {
  if (page * limit > 10000)
    throw new AppError(
      400,
      'SEARCH_PAGE_LIMIT',
      'Narrow your search to view more specific results.',
    );
  const filters = [
    { term: { userId } },
    ...(status ? [{ terms: { status: status.split(',') } }] : []),
    ...(campaignId ? [{ term: { campaignId } }] : []),
  ];
  const result = await elastic.search<{ id: string }>({
    index: env.ELASTICSEARCH_INDEX,
    from: (page - 1) * limit,
    size: limit,
    track_total_hits: true,
    query: {
      bool: {
        filter: filters,
        ...(q
          ? {
              must: [
                {
                  multi_match: {
                    query: q,
                    fields: ['recipient', 'subject'],
                    type: 'best_fields',
                    operator: 'and',
                  },
                },
              ],
            }
          : {}),
      },
    },
    sort: [{ scheduledAt: 'desc' }, { id: 'asc' }],
  });
  const ids = result.hits.hits.map((hit) => hit._id).filter((id): id is string => !!id);
  // Search matching is Elasticsearch; hydration rechecks tenant ownership and returns fresh delivery state.
  const records = await db.email.findMany({ where: { userId, id: { in: ids } } });
  const recordsById = new Map(records.map((email) => [email.id, email]));
  const data = ids.flatMap((id) => (recordsById.has(id) ? [recordsById.get(id)!] : []));
  const total =
    typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
  return paginated(data, total, page, limit);
}
