import { isNativeError } from 'node:util/types'; // CHANGE: Error messages and stacks are non-enumerable, including across test-worker realms.

export default async function* ndjsonReporter(source) {
	for await (const event of source) {
		const errors = new WeakSet(); // CHANGE: preserve nested causes without failing on circular error chains.
		yield `${JSON.stringify(event, (_key, value) => { // CHANGE
			if (!(value instanceof Error) && !isNativeError(value)) return value; // CHANGE: Node reporter transport recreates Error prototypes without a native Error internal slot.
			if (errors.has(value)) return '[Circular Error]'; // CHANGE
			errors.add(value); // CHANGE
			return { ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause }; // CHANGE
		})}\n`; // CHANGE
	}
}
