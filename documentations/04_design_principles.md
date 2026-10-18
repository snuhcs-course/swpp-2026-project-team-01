# Find Me a Time — Design Principles

Date: 2026-10-19\
Status: Product direction; implementation coverage must be verified separately.

These principles guide new features and reviews across the web app, our conversational agent, personal-agent integrations, and command-line tools. They complement the [one-pager](01_one_pager.md) and [product requirements](02_product_requirements.md). Detailed behavior belongs in capability specifications; implementation changes follow the repository's OpenSpec workflow.

Our AI scheduling agent is named **Thyme**. Use Thyme for the assistant’s chat identity, introductions, and conversational references. **Find Me a Time** remains the product name.

The [visual design guide](../DESIGN.md) owns the Thyme botanical identity, paper material, color, typography, and component styling direction. These interaction principles continue to govern how the product behaves.

## 1. The agent can perform user actions

Our agent should be able to do everything a user can do in the product, except explicitly documented human-only actions. A user should be able to describe an intended outcome in chat and have the agent carry it out, without being sent to a form merely because the agent lacks the corresponding tool.

- Give the agent an authorized operation for each user-facing capability, including configuration and later changes—not just reading information or explaining steps.
- Chat and interactive controls operate on the same underlying state, permissions, validation, and action results. Changes through either surface should be visible in the other.
- Apply the acting user's permissions and scope. User capability parity does not grant the agent administrator access or permission to act for another user.
- Report completion only after the service confirms the action. If an operation cannot finish, explain what remains and provide a way to continue.
- Record an explicit reason for every human-only exception. Missing tools are implementation gaps, not permanent exceptions.

For example, “Use my personal and class calendars for conflict checks, and put new meetings on my personal calendar” should let the agent configure those choices once the calendars are unambiguous and access is authorized. It should ask a focused question when a name or intended booking calendar is unclear.

### Human decisions and consent

Capability parity preserves the existing consent and approval requirements. The agent can prepare an action and execute or relay a valid user decision; it cannot manufacture that decision.

Existing boundaries include Google sign-in and provider consent, granting access to a personal agent, and the host's explicit approval of the current meeting proposal. A preference suggestion does not authorize a booking. Required preference reviews and confirmations still apply. See the [product requirements](02_product_requirements.md) and [interfaces](user_experience/03_interfaces.md) for those boundaries.

The complete exception list remains to be specified per capability. Do not invent additional human-only steps or treat this principle as removing an existing confirmation requirement.

## 2. Suggest preferences first

The agent should propose a useful configuration before asking the user to fill out settings. The normal experience is to review a recommendation and say “yes,” correct it in conversation, or adjust it through a compact interactive control.

1. Use the user's stated preferences and authorized context to prepare a concrete recommendation.
2. Explain the proposed choices briefly. Distinguish explicit user choices, inferred suggestions, and starter defaults when that distinction matters.
3. Let the user accept the clear, current suggestion in chat or through an equivalent interactive action, subject to the capability's required review and confirmation rules.
4. Ask one focused question when information is missing. Update the recommendation from the answer instead of restarting a questionnaire.
5. Show detailed configuration controls when requested or needed to resolve a choice. Keep them available for direct editing, without making them the default first step.
6. Confirm what was saved, and keep the conversation and controls consistent.

For example: “I suggest weekdays, 10 am–5 pm, with 30-minute meetings and a 15-minute buffer. Does that work?” The user can say “Yes,” reply “Only afternoons,” or open an adjustment control. These values are illustrative, not product defaults.

A “yes” must refer to an identifiable current suggestion. If the suggestion has changed or the reference is ambiguous, clarify before applying it. Suggestions must not silently overwrite confirmed preferences, infer consent to unavailable data, or bypass required final review. Where the current contract requires a protected confirmation surface, the agent prepares that review and guides the user to it; changing that contract requires a separate behavior change.

## 3. Provide separate user and administrator CLIs

The product must have two distinct command-line interfaces: one for users and their authorized agents, and one for our team to administer the service.

| | User CLI | Administrator CLI |
|---|---|---|
| Audience | Hosts, requesters, their authorized agents, and user scripts | Authorized team members operating Find Me a Time |
| Purpose | Perform role-appropriate product actions from a terminal | Perform privileged service administration |
| Examples | Read request state, configure authorized preferences, coordinate meetings, and continue required human reviews | Issue or revoke host invitations, inspect operational state, and perform permitted recovery operations |
| Authority | The signed-in user's or delegated client's scoped permissions | Explicit operator authorization for the intended environment |
| Interface boundary | No administrator commands or service credentials | Separate command entry point, authentication, and documentation |

Both CLIs should use the same domain operations and validation as other authorized surfaces, return structured results suitable for automation, and make errors and incomplete actions clear. Their authority must remain separate on the server; hiding administrator commands from user help is insufficient. An administrator CLI must not be implemented as an elevated mode of a user's connection.

### Planned tooling and remaining decisions

The [CLI direction](technical_specification/06_cli.md) defines the future user and administrator surfaces. No command or capability parity is implemented yet.

Final executable names, packaging/distribution, the complete command inventories, and administrator authentication are implementation decisions still to be specified. This document establishes the two-CLI direction without inventing commands or asserting unverified support.

## Applying the principles

For each feature, review:

- Can the user ask the agent to perform the action, and is every exception explicit?
- Does the agent offer a useful suggestion before requiring manual configuration?
- Can chat acceptance and interactive controls reach the same authorized outcome while preserving required confirmations?
- Does the capability belong in the user CLI, the administrator CLI, or both with distinct authorization?

Track gaps through bounded OpenSpec changes. Keep the [implementation plan](technical_specification/04_implementation_plan.md) and owning capability specifications aligned as those changes are implemented and verified.
