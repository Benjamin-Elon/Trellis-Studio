export default async function* ndjsonReporter(source) {
	for await (const event of source) {
		yield `${JSON.stringify(event)}\n`;
	}
}
