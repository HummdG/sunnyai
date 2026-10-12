// @sunny/contracts — the single source of truth for shapes that cross a process
// boundary. Both the API and the widget import from here, so a change that would
// break one breaks the other's typecheck in the same commit.

export * from './errors.js';
export * from './events.js';
export * from './chat.js';
export * from './widget.js';
export * from './leads.js';
export * from './consent.js';
export * from './qualification.js';
export * from './catalogue.js';
export * from './knowledge.js';
export * from './audit.js';
export * from './dashboard.js';
export * from './sunscan.js';
