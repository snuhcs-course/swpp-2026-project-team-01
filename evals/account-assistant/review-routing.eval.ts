import { HOST_REVIEW_STORY_CASES } from "../host-review/story-cases";
import { storyEvals } from "../story/runner";

// D1 reverses the switching expectations of these two historical cases. Their
// account audience needs host_setup eval auth; do not widen host_review auth
// or execute the same case under an incompatible session in that set.
export default storyEvals(HOST_REVIEW_STORY_CASES.filter(entry => entry.conversation === "host_setup"), "account-assistant");
