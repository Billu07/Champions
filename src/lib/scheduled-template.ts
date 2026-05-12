import type { SlotKey } from "@/lib/types";

export function scheduledBodyParameters(slot: SlotKey, employeeName: string): Array<{
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
        text: "আজকের দিনটি আত্মবিশ্বাস, ফোকাস ও পেশাদারিত্বের সাথে শুরু করুন।",
      },
    ];
  }

  return [{ type: "text", parameterName: "employee_name", text: employeeName }];
}
