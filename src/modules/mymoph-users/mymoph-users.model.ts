import type { Db, Document, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';

interface MymophUserDocument extends Document {
  _id: ObjectId;
  cid?: string;
  email?: string;
  is_kyc?: string;
  is_ekyc?: string;
  first_name?: string;
  last_name?: string;
}

interface ListInput {
  search: string;
  pageSize: number;
  offset: number;
}

interface ArchiveDeleteInput {
  id: string;
  reason: string;
  actorUserId: string;
  actorCid: string;
  requestId?: string;
}

export class MymophUsersModel {
  constructor(
    private readonly getDb: () => Promise<Db>,
    private readonly usersCollectionName: string,
    private readonly usersRemoveCollectionName: string
  ) {}

  async list(input: ListInput) {
    const db = await this.getDb();
    const collection = db.collection<MymophUserDocument>(this.usersCollectionName);
    const filter = this.buildSearchFilter(input.search);

    const [total, rows] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter, {
          projection: {
            cid: 1,
            email: 1,
            is_kyc: 1,
            is_ekyc: 1,
            first_name: 1,
            last_name: 1
          }
        })
        .sort({ _id: 1 })
        .skip(input.offset)
        .limit(input.pageSize)
        .toArray()
    ]);

    return { total, rows };
  }

  async findById(id: string): Promise<MymophUserDocument | null> {
    const db = await this.getDb();
    return db.collection<MymophUserDocument>(this.usersCollectionName).findOne({
      _id: new ObjectId(id)
    });
  }

  async archiveAndDelete(input: ArchiveDeleteInput) {
    const db = await this.getDb();
    const users = db.collection<MymophUserDocument>(this.usersCollectionName);
    const removedUsers = db.collection(this.usersRemoveCollectionName);
    const objectId = new ObjectId(input.id);
    const user = await users.findOne({ _id: objectId });

    if (!user) {
      return { status: 'not_found' as const };
    }

    const archivedAt = new Date();
    const archiveResult = await removedUsers.insertOne({
      source_id: user._id,
      cid: user.cid ?? null,
      admin_cid: input.actorCid,
      deleted_by_user_id: input.actorUserId,
      reason: input.reason,
      request_id: input.requestId ?? null,
      status: 'pending',
      archived_at: archivedAt,
      data: user
    });

    try {
      const deleteResult = await users.deleteOne({ _id: objectId });
      if (deleteResult.deletedCount !== 1) {
        await removedUsers.updateOne(
          { _id: archiveResult.insertedId },
          { $set: { status: 'failed', failed_at: new Date(), failure_reason: 'USER_DELETE_CONFLICT' } }
        );
        return { status: 'conflict' as const };
      }

      await removedUsers.updateOne(
        { _id: archiveResult.insertedId },
        { $set: { status: 'completed', completed_at: new Date() } }
      );

      return { status: 'deleted' as const, archiveId: archiveResult.insertedId.toHexString() };
    } catch (error) {
      await removedUsers.updateOne(
        { _id: archiveResult.insertedId },
        { $set: { status: 'failed', failed_at: new Date(), failure_reason: 'USER_DELETE_FAILED' } }
      );
      throw error;
    }
  }

  private buildSearchFilter(search: string): Filter<MymophUserDocument> {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (/^\d+$/.test(search)) {
      return { cid: { $regex: `^${escaped}` } };
    }

    if (search.includes('@')) {
      return { email: { $regex: `^${escaped}$`, $options: 'i' } };
    }

    return {
      $or: [
        { cid: { $regex: `^${escaped}` } },
        { email: { $regex: `^${escaped}`, $options: 'i' } }
      ]
    };
  }
}
