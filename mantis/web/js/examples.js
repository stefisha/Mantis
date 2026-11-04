export const DEMO_PROMPTS = {
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
  if (/record|handover|handing|technician|log|zabele/i.test(question)) {
    return "Here’s a sample handover note to build on:\n\n• Equipment model and controller\n• Exact alarm code and message\n• Time of the event and operating conditions\n• Any unusual noise, vibration, or heat\n• Recent tool changes or maintenance\n• A photo of the screen, if your site permits it\n\nInclude what happened before the alarm. The maintenance team can then compare it with the correct manual and decide the next safe step.";
  }
  if (/spindle|overload|noise|vibrat|vreten|preoptere/i.test(question)) {
    return "Let’s start with the context, before assuming a cause.\n\nAn overload message and a change in sound are useful observations, but they don’t identify a fault on their own. Follow the site’s stop and isolation procedures if abnormal operation is suspected.\n\nFor the maintenance handover, capture:\n01 / The exact alarm and machine model\n02 / When the sound changed\n03 / The operation and tool in use\n04 / Any recent setup or maintenance changes\n\nDo you also have a photo of the alarm screen? You can try the sample photo below.";
  }
  return "This is a scripted interaction preview, so I can’t diagnose that issue or search your manuals here.\n\nTry “Spindle overload”, “Try an alarm photo”, or “What should I record?” to explore the prepared conversation.\n\nTo ask questions about your own PDF manual, open the maintenance workspace. Live manual answers require a configured API key; switch out of the example to use live photo analysis with a configured AI service.";
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
    !kind && /spindle|overload|record|handover|vibrat/i.test(question)
      ? [
          {
            name: "Illustrative CNC handover notes",
            document_id: "demo",
            page: 1,
            text: "Record the equipment model and controller, exact alarm message, operating conditions, unusual noise or vibration, and recent tool or maintenance changes. Compare observations with the correct manufacturer documentation. This is example material, not an equipment service procedure.",
          },
        ]
      : [];
  return { answer, sources, demo: true, insufficient_evidence: true };
}
