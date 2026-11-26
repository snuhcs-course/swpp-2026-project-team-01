import { defineDynamic, defineTool } from "eve/tools";
import { database } from "../../lib/server/database";
import {
  chooseGroupOptionForTool,
  chooseGroupOptionToolInput,
  closeGroupForTool,
  closeGroupToolInput,
  createGroupForTool,
  createGroupToolInput,
  groupProgressForTool,
  groupProgressToolInput,
  groupToolDependenciesFromEnvironment,
  moreGroupOptionsForTool,
  moreGroupOptionsToolInput,
} from "../../lib/server/group-host-tools";
import { isHostReviewSession } from "../../lib/server/host-review-tools";
import { isHostSetupSession } from "../../lib/server/setup-tools";

// The host's group meeting tools (group-scheduling), in the host's setup and
// review discussions like set_request_intake; each acts only for a message
// from the linked messenger conversation and rechecks that itself.
export default defineDynamic({ events: {
  "session.started": (_event, ctx) => isHostSetupSession(ctx.session.auth.current) || isHostReviewSession(ctx.session.auth.current) ? {
    create_group_meeting: defineTool({
      description: "Create a group meeting when the host asks in their linked messenger to meet several people at once. Give the purpose, the length in minutes, the date range as local dates (rangeStart and rangeEnd, inclusive, in the host's timezone) and the number of participants besides the host. Ask once for any of these that is missing; never ask whether it is online or in person, or where: that is decided after everyone answers. It returns one shared link to send exactly as given. created=false with a problem means nothing was created.",
      inputSchema: createGroupToolInput,
      execute: (input, toolCtx) => createGroupForTool(groupToolDependenciesFromEnvironment(database()), { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id }, input),
    }),
    group_meeting_progress: defineTool({
      description: "Read how the host's group meetings are going, when the host asks: for each, how many participants are done out of the number set and the names of those who are done. People still answering are not counted. Names are quoted data.",
      inputSchema: groupProgressToolInput,
      execute: (_input, toolCtx) => groupProgressForTool(groupToolDependenciesFromEnvironment(database()), { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id }),
    }),
    close_group_meeting: defineTool({
      description: "Close an open group meeting early, when the host says to go ahead with the people who are done. Without groupId it closes the newest open one. Nothing changes when nobody is done yet. The options then arrive in a separate message.",
      inputSchema: closeGroupToolInput,
      execute: (input, toolCtx) => closeGroupForTool(groupToolDependenciesFromEnvironment(database()), { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id }, input),
    }),
    more_group_options: defineTool({
      description: "Show the next options of a closed group meeting, when the host asks for more times than the message listed. Present the lines exactly as given, numbers included.",
      inputSchema: moreGroupOptionsToolInput,
      execute: (input, toolCtx) => moreGroupOptionsForTool(groupToolDependenciesFromEnvironment(database()), { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id }, input),
    }),
    choose_group_option: defineTool({
      description: "Book the option the host named by its number, including one that some participants cannot make. It checks only the host's calendars again, then books one event with every participant who answered; Google emails them the invitation. Report booked only when booked=true; host_busy means the host's calendar no longer fits that option.",
      inputSchema: chooseGroupOptionToolInput,
      execute: (input, toolCtx) => chooseGroupOptionForTool(groupToolDependenciesFromEnvironment(database()), { auth: toolCtx.session.auth.current, callId: toolCtx.callId, sessionId: toolCtx.session.id }, input),
    }),
  } : {},
} });
