// The solve server's monthly spend, kept in a DynamoDB table so it refuses requests once the month's budget is spent instead of running the AWS account
// into its limit. USAGE_TABLE names the table (key "month", e.g. "2026-10"; "gbs" the GB-seconds its requests ran, with the most the ones running
// now may still run; "calls" how many); without it (running locally) nothing is counted

// The table, or none
const TABLE = process.env.USAGE_TABLE;
// DynamoDB client (the AWS SDK comes with Lambda's Node runtime), loaded on first use
let client: Promise<any> | null = null;

// This month's key, in UTC (AWS bills by UTC months)
export function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// The SDK's DynamoDB module and a client
function dynamo(): Promise<{ sdk: any; db: any }> {
  client ??= import("@aws-sdk/client-dynamodb").then((sdk) => ({ sdk, db: new sdk.DynamoDBClient({}) }));
  return client;
}

// GB-seconds and calls counted this month
export async function usedThisMonth(): Promise<{ gbs: number; calls: number }> {
  if (!TABLE) return { gbs: 0, calls: 0 };
  const { sdk, db } = await dynamo();
  const { Item } = await db.send(new sdk.GetItemCommand({ TableName: TABLE, Key: { month: { S: thisMonth() } }, ConsistentRead: true }));
  return { gbs: Number(Item?.gbs?.N ?? 0), calls: Number(Item?.calls?.N ?? 0) };
}

// Count GB-seconds (less, when negative) and calls
export async function addUsage(gbs: number, calls = 1): Promise<void> {
  if (!TABLE) return;
  const { sdk, db } = await dynamo();
  await db.send(
    new sdk.UpdateItemCommand({
      TableName: TABLE,
      Key: { month: { S: thisMonth() } },
      UpdateExpression: "ADD gbs :gbs, calls :calls",
      ExpressionAttributeValues: { ":gbs": { N: gbs.toFixed(3) }, ":calls": { N: String(calls) } },
    }),
  );
}

// Count a call and the most GB-seconds it may run before it runs, only if they fit in the month's budget with what's counted already (one write, so
// calls at the same time can't both take the last of it); false = they don't fit, and nothing is counted
export async function reserveUsage(gbs: number, budget: number): Promise<boolean> {
  if (!TABLE) return true;
  if (!Number.isFinite(budget)) return addUsage(gbs).then(() => true);
  const { sdk, db } = await dynamo();
  try {
    await db.send(
      new sdk.UpdateItemCommand({
        TableName: TABLE,
        Key: { month: { S: thisMonth() } },
        UpdateExpression: "ADD gbs :gbs, calls :one",
        ConditionExpression: "attribute_not_exists(gbs) OR gbs <= :room",
        ExpressionAttributeValues: { ":gbs": { N: gbs.toFixed(3) }, ":one": { N: "1" }, ":room": { N: (budget - gbs).toFixed(3) } },
      }),
    );
    return true;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}
