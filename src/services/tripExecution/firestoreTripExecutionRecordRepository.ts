/**
 * STEP 80 - Firestore Trip Execution Record Repository
 *
 * Concrete persistence adapter implementing Step 79's repository contract.
 * Uses the project's existing Firebase/Firestore architecture.
 */

import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirestoreInstance } from '../firebase'; // reuse existing Firebase init
import type { TripExecutionRecordRepository } from './tripExecutionRecordRepository';
import { isTripExecutionRecord, type TripExecutionRecord } from './tripExecutionRecord';

const EXECUTION_RECORDS_SUBCOLLECTION = 'executionRecords';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTripId(tripId: unknown): tripId is string {
  if (typeof tripId !== 'string') return false;
  if (tripId.length === 0) return false;
  if (tripId !== tripId.trim()) return false;
  return true;
}

function validateRecordId(recordId: unknown): recordId is string {
  if (typeof recordId !== 'string') return false;
  if (recordId.length === 0) return false;
  return true;
}

interface FirestoreExecutionRecordData {
  kind: 'trip-execution-record';
  tripId: string;
  receiptId: string;
  requestId: string;
  providerIds: string[];
  results: TripExecutionRecord['results'];
  executed: boolean;
  status: TripExecutionRecord['status'] | null;
}

function toFirestoreData(record: TripExecutionRecord): FirestoreExecutionRecordData {
  return {
    kind: record.kind,
    tripId: record.tripId,
    receiptId: record.receiptId,
    requestId: record.requestId,
    providerIds: [...record.providerIds],
    results: record.results.map((entry) => ({
      executed: entry.executed,
      result: entry.result === null ? null : { ...entry.result },
      requestId: entry.requestId,
      providerId: entry.providerId,
      reason: entry.reason,
    })),
    executed: record.executed,
    status: record.status,
  };
}

function fromFirestoreData(
  docId: string,
  tripId: string,
  data: unknown
): TripExecutionRecord | null {
  if (!isObject(data)) return null;

  const candidate: unknown = {
    id: docId,
    kind: data.kind,
    tripId,
    receiptId: data.receiptId,
    requestId: data.requestId,
    providerIds: data.providerIds,
    results: data.results,
    executed: data.executed,
    status: data.status,
  };

  if (!isTripExecutionRecord(candidate)) {
    return null;
  }
  return candidate;
}

export class FirestoreTripExecutionRecordRepository implements TripExecutionRecordRepository {
  async save(record: TripExecutionRecord): Promise<void> {
    if (!isTripExecutionRecord(record)) {
      throw new TypeError('Invalid TripExecutionRecord');
    }

    const db = getFirestoreInstance();
    const collectionRef = collection(db, 'trips', record.tripId, EXECUTION_RECORDS_SUBCOLLECTION);
    const docRef = doc(collectionRef, record.id);
    const data = toFirestoreData(record);
    await setDoc(docRef, data);
  }

  async getById(tripId: string, recordId: string): Promise<TripExecutionRecord | null> {
    if (!validateTripId(tripId)) {
      return null;
    }
    if (!validateRecordId(recordId)) {
      return null;
    }

    const db = getFirestoreInstance();
    const collectionRef = collection(db, 'trips', tripId, EXECUTION_RECORDS_SUBCOLLECTION);
    const docRef = doc(collectionRef, recordId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return null;
    }
    return fromFirestoreData(recordId, tripId, snap.data());
  }

  async listByTripId(tripId: string): Promise<TripExecutionRecord[]> {
    if (!validateTripId(tripId)) {
      return [];
    }

    const db = getFirestoreInstance();
    const collectionRef = collection(db, 'trips', tripId, EXECUTION_RECORDS_SUBCOLLECTION);
    const { getDocs } = await import('firebase/firestore');
    const snap = await getDocs(collectionRef);
    const records: TripExecutionRecord[] = [];
    snap.forEach((docSnap) => {
      const record = fromFirestoreData(docSnap.id, tripId, docSnap.data());
      if (record !== null) {
        records.push(record);
      }
    });
    return records;
  }
}

export function createFirestoreTripExecutionRecordRepository(): FirestoreTripExecutionRecordRepository {
  return new FirestoreTripExecutionRecordRepository();
}
