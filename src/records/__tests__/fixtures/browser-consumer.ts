import { createObjectRecordSink, readObjectRecord, type ObjectRecordStorage, type ObjectRecordReadStorage, type ObjectRecordReadResult } from 'footprint-blueprint/records/object-store';
const storage: ObjectRecordStorage = { put: async () => {}, get: async () => undefined, list: async () => ({ keys: [] }) };
createObjectRecordSink({ storage, storeId: 'browser-brand', runId: 'run-one' }).stats();
const reader: ObjectRecordReadStorage = { get: storage.get, list: storage.list };
const result: Promise<ObjectRecordReadResult> = readObjectRecord({ storage: reader, storeId: 'browser-brand', runId: 'run-one' });
void result;
