export const DEMO_PROMPTS = {
  vibration: "What should I check for excessive vibration?",
  overheating: "What should I check for overheating?",
  spindle:
    "My CNC machine reports “spindle overload” and sounds louder than usual. What should I check first?",
  alarm:
    "I’m getting these alarms on the machine screen. Can you help me understand them?",
  followup:
    "What should I record before handing this over to a maintenance technician?",
};

/** Deliberately fixed scenarios: no inference, machine diagnosis, or provider calls. */
export function demoReply(question, attachmentKind = null) {
  if (attachmentKind === "local") {
    return "Your photo is visible in this chat, but this demo hasn’t read or analyzed it.\n\nTo explore the prepared photo conversation, choose “Try an alarm photo”. It uses an illustrative screen with known sample labels.\n\nFor a real incident, record the exact alarm text and equipment model, then consult the matching manual and your qualified maintenance team.";
  }
  if (attachmentKind === "sample") {
    return "This prepared example lists three alarm labels:\n\n01 / PLC 121 — Machine off\n02 / PLC 122 — Door / safety device\n03 / Battery voltage range\n\nWhat machine model and controller is this? Code meanings vary by equipment. Record the exact messages and when they appeared, then compare them with the matching manual before planning checks.";
  }
  if (/overheat/i.test(question)) {
    return "Overheating — illustrative training example.\n\nRecord the operating load, cooling conditions, and recent lubrication or maintenance history. Compare these observations with the actual manufacturer’s documentation.\n\nWhat machine model is this, and what exact temperature or alarm was recorded? This example does not specify operating limits or equipment service procedures.";
  }
  if (/vibrat/i.test(question) && !/spindle|overload/i.test(question)) {
    return "Excessive vibration — illustrative training example.\n\nRecord when the vibration started, the operating conditions, and any recent setup changes. The matching manual is needed to identify approved checks and limits.\n\nDo you have the equipment model or an alarm message to include in the handover?";
  }
  if (/record|handover|handing|technician|log|zabele/i.test(question)) {
    return "Here’s a sample handover note to build on:\n\n• Equipment model and controller\n• Exact alarm code and message\n• Time of the event and operating conditions\n• Any unusual noise, vibration, or heat\n• Recent tool changes or maintenance\n• A photo of the screen, if your site permits it\n\nInclude what happened before the alarm. The maintenance team can then compare it with the correct manual and decide the next safe step.";
  }
  if (/spindle|overload|noise|vibrat|vreten|preoptere/i.test(question)) {
    return "Let’s start with the context, before assuming a cause.\n\nAn overload message and a change in sound are useful observations, but they don’t identify a fault on their own. Follow the site’s stop and isolation procedures if abnormal operation is suspected.\n\nFor the maintenance handover, capture:\n01 / The exact alarm and machine model\n02 / When the sound changed\n03 / The operation and tool in use\n04 / Any recent setup or maintenance changes\n\nDo you also have a photo of the alarm screen? You can try the sample photo below.";
  }
  return "This is a scripted interaction preview, so I can’t diagnose that issue or search your manuals here.\n\nTry “Spindle overload”, “Try an alarm photo”, or “What should I record?” to explore the prepared conversation.\n\nChoose “Upload your own manual” below to ask about your equipment documentation. Live manual answers require a configured API key; switch out of the example to use live photo analysis with a configured AI service.";
}

export function attachmentError(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size > 8 * 1024 * 1024) return "Choose an image smaller than 8 MB.";
  return null;
}

export function exampleResponse(question, kind = null) {
  const answer = demoReply(question, kind);
  const sources =
    !kind && /spindle|overload|record|handover|vibrat|overheat/i.test(question)
      ? [
          {
            name: /overheat|vibrat/i.test(question)
              ? "Illustrative training notes"
              : "Illustrative CNC handover notes",
            document_id: "demo",
            page: /overheat/i.test(question)
              ? 7
              : /vibrat/i.test(question)
                ? 4
                : 1,
            text: /overheat/i.test(question)
              ? "Overheating — illustrative training notes. Record operating load, cooling conditions, lubrication and maintenance history, machine model, and the exact temperature or alarm. Compare observations with the actual manufacturer documentation. No operating limits or service procedures are specified here."
              : /vibrat/i.test(question)
                ? "Vibration — illustrative training notes. Record the equipment model, when vibration began, operating conditions, recent setup changes, and exact alarm messages. Use the matching manufacturer manual for approved checks and limits."
                : "Record the equipment model and controller, exact alarm message, operating conditions, unusual noise or vibration, and recent tool or maintenance changes. Compare observations with the correct manufacturer documentation. This is example material, not an equipment service procedure.",
          },
        ]
      : [];
  return { answer, sources, demo: true, insufficient_evidence: true };
}
