// Central prompt definitions for Tech Interview Chat.
// Keep prompt text here so chatGPT.js can stay focused on injection/reliability.
(function () {
    "use strict";

    const conversationPrompts = {
        normal: "Please provide me with just the answer in spoken English. Make it concise, within five sentences, so I can easily share it in an interview. Please add a blank line after each paragraph.  ->  ",
        detail: "Please give me a more detailed interview answer in natural spoken English. Explain the reasoning clearly, include practical examples when useful, and keep it easy to say out loud. Please add a blank line after each paragraph.  ->  ",
        star: "Please help me answer this using the STAR method in natural spoken English: Situation, Task, Action, and Result. Keep it authentic, concise enough for an interview, and easy to say out loud. Please add a blank line after each paragraph.  ->  "
    };

    const codingPrompts = {
        normal: "I'm in a live coding interview. Help me think through this problem step by step with a clear approach I can explain while coding. Keep it concise and practical.  ->  ",
        detail: "I'm in a live coding interview. Give me a detailed technical approach: clarify the problem, discuss edge cases, explain the algorithm/design, provide implementation guidance, and mention complexity when useful.  ->  ",
        star: "I'm in a technical interview. Help me structure this as a STAR-style technical explanation: Situation, Task, Action, and Result, while keeping it natural and practical.  ->  "
    };

    const followUpPrompts = {
        detail: "Please expand your previous answer with more detail, but keep it natural for spoken interview delivery. Make it clear, confident, and easy to say out loud.",
        technical: "Please make your previous answer more technical and specific. Include concrete implementation details, trade-offs, and practical engineering reasoning while keeping it interview-friendly.",
        star: "Please rewrite your previous answer using a stronger STAR structure. Keep it natural, concise, and easy to say in an interview."
    };

    window.TECH_INT_GPT_PROMPTS = {
        version: "oldbase-triple-checked-2026-06-03",
        conversation: conversationPrompts,
        coding: codingPrompts,
        followUp: followUpPrompts
    };
})();
