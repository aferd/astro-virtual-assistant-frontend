import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { produce } from 'immer';
import { AssistantMessage, FeedbackMessage, From, Message } from '../../types/Message';
import { PostTalkResponse, postTalk } from '../../api/PostTalk';
import { asyncSleep } from '../../utils/Async';
import Config from '../../Config';
import { MessageProcessor } from '../Message/MessageProcessor';
import { Command } from '../../types/Command';
import { buildMetadata } from '../../utils/Metadata';

type SetMessages = Dispatch<SetStateAction<Array<Message>>>;

const loadMessage = async (
  from: From.ASSISTANT | From.FEEDBACK,
  content: Promise<PostTalkResponse> | PostTalkResponse | string | undefined,
  setMessages: SetMessages,
  minTimeout: number,
  processors: Array<MessageProcessor>
) => {
  setMessages(
    produce((draft) => {
      draft.push({
        from,
        isLoading: true,
        content: '',
      });
    })
  );

  const startTime = new Date().getTime();
  const resolvedContent = await content;

  const endTime = new Date().getTime();
  const remainingTime = Math.max(minTimeout - endTime + startTime, 0);

  await asyncSleep(remainingTime);

  if (resolvedContent !== undefined) {
    const contentString = typeof resolvedContent === 'string' ? resolvedContent : resolvedContent.text;

    const message: AssistantMessage | FeedbackMessage = {
      from,
      isLoading: false,
      content: contentString,
    };

    if (typeof resolvedContent !== 'string' && from === From.ASSISTANT) {
      if (resolvedContent.buttons) {
        (message as AssistantMessage).options = resolvedContent.buttons.map((b) => ({
          title: b.title,
          payload: b.payload,
        }));
      }

      if (resolvedContent.custom) {
        if (resolvedContent.custom.type === 'command' && resolvedContent.custom.command) {
          (message as AssistantMessage).command = {
            type: resolvedContent.custom.command,
            params: resolvedContent.custom.params,
          } as Command;
        }
      }
    }

    await messageProcessor(message, processors);

    setMessages(
      produce((draft) => {
        draft.pop();
        draft.push(message);
      })
    );
  } else {
    setMessages(
      produce((draft) => {
        draft.pop();
      })
    );
  }
};

const messageProcessor = async (message: AssistantMessage | FeedbackMessage, processors: Array<MessageProcessor>) => {
  for (const processor of processors) {
    await processor(message);
  }
};

export interface AskOptions {
  hideMessage: boolean;
  hideResponse: boolean;
  label: string;
  waitResponses: boolean;
}

export const enum Status {
  LOADING = 'LOADING',
  STARTED = 'STARTED',
  NOT_STARTED = 'NOT_STARTED',
}

export const useAstro = (messageProcessors: Array<MessageProcessor>) => {
  const [messages, setMessages] = useState<Array<Message>>([]);
  const [status, setStatus] = useState<Status>(Status.NOT_STARTED);

  const ask = useCallback(
    async (message: string, options?: Partial<AskOptions>) => {
      const validOptions: AskOptions = {
        ...{
          hideMessage: false,
          label: message,
          waitResponses: true,
          hideResponse: false,
        },
        ...options,
      };

      if (message) {
        if (!options?.hideMessage) {
          setMessages(
            produce((draft) => {
              draft.push({
                from: From.USER,
                content: validOptions.label,
              });
            })
          );
        }

        const postTalkResponse = postTalk(message, buildMetadata());

        const waitResponses = async () => {
          if (options?.hideResponse) {
            return;
          }

          await loadMessage(
            From.ASSISTANT,
            postTalkResponse.then((r) => r[0]),
            setMessages,
            Config.messages.delays.minAssistantResponse,
            messageProcessors
          );

          // responses has already been resolved
          const responses = await postTalkResponse;
          for (let i = 1; i < responses.length; i++) {
            await loadMessage(From.ASSISTANT, responses[i], setMessages, Config.messages.delays.minAssistantResponse, messageProcessors);
          }
        };

        if (validOptions.waitResponses) {
          await waitResponses();
        } else {
          void waitResponses();
          await postTalkResponse;
        }
      }
    },
    [messageProcessors]
  );

  const start = useCallback(async () => {
    if (status === Status.NOT_STARTED) {
      setStatus(Status.LOADING);

      await ask('/session_start', {
        hideMessage: true,
        hideResponse: true,
        waitResponses: false,
      });

      await ask('/intent_core_session_start', {
        hideMessage: true,
        waitResponses: false,
      });

      setStatus(Status.STARTED);
    }
  }, [ask, status]);

  const stop = useCallback(async () => {
    if (status === Status.STARTED) {
      setMessages([]);
      setStatus(Status.NOT_STARTED);
    }
  }, [ask, status]);

  return {
    ask,
    messages,
    start,
    stop,
    status,
  };
};
