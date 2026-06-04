## ADDED Requirements

### Requirement: Packaged Prometheus Skill Availability

The application SHALL verify that the packaged Prometheus skill-system resource
contains the nested skills required for artifact creation, artifact refinement,
KBD process orchestration, and sycophancy auditing.

#### Scenario: Required Prometheus skills are packaged

- **WHEN** the skill governance check runs
- **THEN** it validates `resources/skills/prometheus-skill-system`
- **AND** it requires the artifact-refiner root skill and nested refine skills
- **AND** it requires the KBD process orchestrator and subprocess skills
- **AND** it requires the imported sycophancy-correction skill.

### Requirement: Prometheus Built-In Discovery Coverage

The built-in skill installer SHALL discover required nested Prometheus skills
through the existing recursive built-in skill path.

#### Scenario: Required nested Prometheus skills are installed as built-ins

- **WHEN** the packaged Prometheus skill-system resource has no direct root
  `SKILL.md`
- **THEN** nested required skills are discovered recursively
- **AND** each discovered skill is copied into the global built-in skill
  destination with a stable sanitized folder name
- **AND** each discovered skill records a source URL pointing to the packaged
  Prometheus skill-system source path.

### Requirement: Scoped Prometheus Skill Selection

Prometheus built-in skills SHALL remain available through existing skill scope
resolution without requiring new Redux state or database schema.

#### Scenario: Scoped selections include Prometheus built-ins

- **WHEN** Prometheus built-in skills are installed
- **AND** global, assistant, agent, or session skill scopes select those skills
- **THEN** the scope service lists the skills with enablement resolved from the
  existing scope configuration rules.
