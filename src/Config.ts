const config = {
  messages: {
    delays: {
      // Artificial delays (ms) to avoid overwhelming the user
      minAssistantResponse: 1200,
      feedback: 1000,
    },
  },
};

const readonlyConfig: Readonly<typeof config> = config;

export default readonlyConfig;
