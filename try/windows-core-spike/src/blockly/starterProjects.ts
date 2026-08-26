import type { JsonValue } from "../core/json";

/** Built-in editable starter used for the course-assistant POC recording. */
export function createCourseAssistantStarterWorkspace(): JsonValue {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "core.agent.define",
        id: "poc-course-agent",
        x: 0,
        y: 0,
        fields: { NAME: "自然科学课程助教" },
        inputs: {
          MEMBERS: {
            block: {
              type: "core.interaction.chat_entry",
              id: "poc-course-entry",
              fields: { NAME: "课程问答" },
              inputs: {
                CAPABILITIES: {
                  block: {
                    type: "core.interaction.accept_text",
                    id: "poc-course-accept-text",
                    next: {
                      block: {
                        type: "core.interaction.accept_image",
                        id: "poc-course-accept-image",
                        next: {
                          block: {
                            type: "core.interaction.accept_file",
                            id: "poc-course-accept-file",
                            next: {
                              block: {
                                type: "core.interaction.accept_voice",
                                id: "poc-course-accept-voice",
                                next: {
                                  block: {
                                    type: "core.interaction.expose_skill",
                                    id: "poc-course-skill",
                                    fields: {
                                      SKILL: "course-material-analysis",
                                    },
                                    next: {
                                      block: {
                                        type: "core.interaction.expose_plugin",
                                        id: "poc-course-plugin",
                                        fields: {
                                          PLUGIN: "create-learning-card",
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                HANDLER: {
                  block: {
                    type: "core.message.reply",
                    id: "poc-course-reply",
                    inputs: {
                      MESSAGE: {
                        block: {
                          type: "core.message.create",
                          id: "poc-course-message",
                          inputs: {
                            CONTENT: {
                              block: {
                                type: "core.output.markdown",
                                id: "poc-course-markdown",
                                inputs: {
                                  CONTENT: {
                                    block: {
                                      type: "core.knowledge.cite",
                                      id: "poc-course-cite",
                                      inputs: {
                                        ANSWER: {
                                          block: {
                                            type: "core.guardrail.check_output",
                                            id: "poc-course-guardrail",
                                            fields: { POLICY: "无依据标注待核实" },
                                            inputs: {
                                              OUTPUT: {
                                                block: {
                                                  type: "core.model.call",
                                                  id: "poc-course-model",
                                                  inputs: {
                                                    CONTEXT: {
                                                      block: {
                                                        type: "core.knowledge.rerank",
                                                        id: "poc-course-rerank",
                                                        inputs: {
                                                          EVIDENCE: {
                                                            block: {
                                                              type: "core.knowledge.retrieve",
                                                              id: "poc-course-retrieve",
                                                              fields: {
                                                                SOURCE_ID: "knowledge.course.primary-science",
                                                              },
                                                              inputs: {
                                                                PLAN: {
                                                                  block: {
                                                                    type: "core.reason.plan",
                                                                    id: "poc-course-plan",
                                                                  },
                                                                },
                                                              },
                                                            },
                                                          },
                                                        },
                                                      },
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }],
    },
  };
}
