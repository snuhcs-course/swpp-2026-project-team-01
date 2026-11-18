import { storyEvals } from "../story/runner";
import { GUEST_STORY_CASES } from "./story-cases";

// The fixed guest story set: each case runs three times as separate evals.
export default storyEvals(GUEST_STORY_CASES, "story");
