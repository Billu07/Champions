import type { SlotKey } from "@/lib/types";

export const FALLBACK_MORNING_TEMPLATE_BODY =
  "\u0986\u099c\u0995\u09c7\u09b0 \u09a6\u09bf\u09a8\u099f\u09bf \u0986\u09a4\u09cd\u09ae\u09ac\u09bf\u09b6\u09cd\u09ac\u09be\u09b8, \u09ab\u09cb\u0995\u09be\u09b8 \u0993 \u09aa\u09c7\u09b6\u09be\u09a6\u09be\u09b0\u09bf\u09a4\u09cd\u09ac\u09c7\u09b0 \u09b8\u09be\u09a5\u09c7 \u09b6\u09c1\u09b0\u09c1 \u0995\u09b0\u09c1\u09a8\u0964";

export function scheduledBodyParameters(
  slot: SlotKey,
  employeeName: string,
  morningBodyText = FALLBACK_MORNING_TEMPLATE_BODY,
): Array<{
  type: "text";
  text: string;
  parameterName: string;
}> {
  if (slot === "morning") {
    return [
      { type: "text", parameterName: "employee_name", text: employeeName },
      {
        type: "text",
        parameterName: "body",
        text: morningBodyText.trim() || FALLBACK_MORNING_TEMPLATE_BODY,
      },
    ];
  }

  return [{ type: "text", parameterName: "employee_name", text: employeeName }];
}
