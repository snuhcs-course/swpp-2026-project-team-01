import { storyEvals } from "../story/runner";
import { HOST_REVIEW_STORY_CASES } from "./story-cases";

// The fixed host review story set: each case runs three times as separate evals.
export default storyEvals(HOST_REVIEW_STORY_CASES, "story");
