'use client';

import { useEffect, useState } from 'react';
import { AdminTabs, PageHeader } from '@/components/nav-shell';
import { TrashIcon } from '@/components/icons';
import { Button, Card, Field, Input, SectionTitle, Switch } from '@/components/ui';
import {
  useAddRecipient,
  useDeleteRecipient,
  useRecipients,
  useSendDigestNow,
  useSettings,
  useTestMail,
  useUpdateSettings,
} from '@/lib/queries';

export default function AdminSettingsPage() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const recipients = useRecipients();
  const addRecipient = useAddRecipient();
  const deleteRecipient = useDeleteRecipient();
  const testMail = useTestMail();
  const sendDigest = useSendDigestNow();

  const [llm, setLlm] = useState({ apiKey: '', baseUrl: '', model: '', temperature: 0.3, maxInputCharsPerArticle: 8000 });
  const [smtp, setSmtp] = useState({
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from: '',
  });
  const [digest, setDigest] = useState({ enabled: true, sendTime: '08:00', maxArticles: 20, includeDigest: true });
  const [fetch, setFetch] = useState({
    lookbackDays: 3,
    dailyLimitPerAccount: 50,
    requestDelayMs: 3000,
    searchEndpoint: '',
    rsshubBaseUrl: '',
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setLlm({
      apiKey: settings.llm.apiKey,
      baseUrl: settings.llm.baseUrl,
      model: settings.llm.model,
      temperature: settings.llm.temperature,
      maxInputCharsPerArticle: settings.llm.maxInputCharsPerArticle,
    });
    setSmtp({
      host: settings.smtp.host,
      port: settings.smtp.port,
      secure: settings.smtp.secure,
      user: settings.smtp.user,
      pass: settings.smtp.pass,
      from: settings.smtp.from,
    });
    setDigest(settings.digest);
    setFetch({
      lookbackDays: settings.fetch.lookbackDays,
      dailyLimitPerAccount: settings.fetch.dailyLimitPerAccount,
      requestDelayMs: settings.fetch.requestDelayMs,
      searchEndpoint: settings.fetch.searchEndpoint ?? '',
      rsshubBaseUrl: settings.fetch.rsshubBaseUrl ?? '',
    });
  }, [settings]);

  const save = async (patch: Parameters<typeof updateSettings.mutateAsync>[0], label: string) => {
    setNotice(null);
    try {
      await updateSettings.mutateAsync(patch);
      setNotice(`${label}已保存`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败');
    }
  };

  const doTest = async () => {
    setNotice(null);
    try {
      const result = await testMail.mutateAsync(undefined);
      setNotice(`测试邮件已发送至 ${result.to.join('、')}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '测试发送失败');
    }
  };

  return (
    <div>
      <PageHeader title="设置" subtitle="AI、邮件与抓取参数" />
      <div className="space-y-4 px-4 pb-8 sm:px-0">
        <AdminTabs />

        {notice ? (
          <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-500">
            {notice}
          </div>
        ) : null}

        <Card className="p-4">
          <SectionTitle title="AI 总结（DeepSeek）" />
          <div className="space-y-3">
            <Field label="API Key" hint="留空则使用环境变量 DEEPSEEK_API_KEY，已保存时显示为掩码">
              <Input
                type="password"
                value={llm.apiKey}
                onChange={(event) => setLlm({ ...llm, apiKey: event.target.value })}
                placeholder="sk-..."
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Base URL">
                <Input value={llm.baseUrl} onChange={(event) => setLlm({ ...llm, baseUrl: event.target.value })} />
              </Field>
              <Field label="模型">
                <Input value={llm.model} onChange={(event) => setLlm({ ...llm, model: event.target.value })} />
              </Field>
              <Field label="温度" hint="0-2，越低越稳定">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={llm.temperature}
                  onChange={(event) => setLlm({ ...llm, temperature: Number(event.target.value) })}
                />
              </Field>
              <Field label="单篇最大输入字数">
                <Input
                  type="number"
                  value={llm.maxInputCharsPerArticle}
                  onChange={(event) => setLlm({ ...llm, maxInputCharsPerArticle: Number(event.target.value) })}
                />
              </Field>
            </div>
            <Button
              loading={updateSettings.isPending}
              onClick={() =>
                void save(
                  {
                    llm: {
                      apiKey: llm.apiKey,
                      baseUrl: llm.baseUrl,
                      model: llm.model,
                      temperature: llm.temperature,
                      maxInputCharsPerArticle: llm.maxInputCharsPerArticle,
                    },
                  },
                  'AI 设置',
                )
              }
            >
              保存 AI 设置
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle title="邮件推送" />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-6">
              <Switch checked={digest.enabled} onChange={(value) => setDigest({ ...digest, enabled: value })} label="启用每日推送" />
              <Switch
                checked={digest.includeDigest}
                onChange={(value) => setDigest({ ...digest, includeDigest: value })}
                label="邮件内附 AI 总结"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="发送时间" hint="24 小时制，修改后需重启应用 生效">
                <Input
                  type="time"
                  value={digest.sendTime}
                  onChange={(event) => setDigest({ ...digest, sendTime: event.target.value })}
                />
              </Field>
              <Field label="每封最多文章数">
                <Input
                  type="number"
                  value={digest.maxArticles}
                  onChange={(event) => setDigest({ ...digest, maxArticles: Number(event.target.value) })}
                />
              </Field>
            </div>

            <div className="grid gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-2 dark:border-zinc-800">
              <Field label="SMTP 服务器">
                <Input value={smtp.host} onChange={(event) => setSmtp({ ...smtp, host: event.target.value })} />
              </Field>
              <Field label="端口">
                <Input
                  type="number"
                  value={smtp.port}
                  onChange={(event) => setSmtp({ ...smtp, port: Number(event.target.value) })}
                />
              </Field>
              <Field label="账号">
                <Input value={smtp.user} onChange={(event) => setSmtp({ ...smtp, user: event.target.value })} />
              </Field>
              <Field label="授权码" hint="163 邮箱需使用 SMTP 授权码，不是登录密码">
                <Input
                  type="password"
                  value={smtp.pass}
                  onChange={(event) => setSmtp({ ...smtp, pass: event.target.value })}
                  placeholder="******"
                />
              </Field>
              <Field label="发件人" hint="必须与 SMTP 账号一致，否则 163 会拒发">
                <Input value={smtp.from} onChange={(event) => setSmtp({ ...smtp, from: event.target.value })} />
              </Field>
              <div className="flex items-end">
                <Switch checked={smtp.secure} onChange={(value) => setSmtp({ ...smtp, secure: value })} label="使用 SSL" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                loading={updateSettings.isPending}
                onClick={() => void save({ digest, smtp }, '邮件设置')}
              >
                保存邮件设置
              </Button>
              <Button variant="secondary" loading={testMail.isPending} onClick={() => void doTest()}>
                发送测试邮件
              </Button>
              <Button
                variant="secondary"
                loading={sendDigest.isPending}
                onClick={async () => {
                  await sendDigest.mutateAsync(undefined);
                  setNotice('已提交发送任务，稍后查看日志');
                }}
              >
                立即发送今日日报
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle title="收件人" />
          <div className="flex gap-2">
            <Input
              value={newRecipient}
              onChange={(event) => setNewRecipient(event.target.value)}
              placeholder="someone@example.com"
            />
            <Button
              variant="secondary"
              loading={addRecipient.isPending}
              onClick={async () => {
                if (!newRecipient.trim()) return;
                try {
                  await addRecipient.mutateAsync({ email: newRecipient.trim() });
                  setNewRecipient('');
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : '添加失败');
                }
              }}
            >
              添加
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {(recipients.data ?? []).map((recipient) => (
              <div
                key={recipient.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              >
                <span>{recipient.email}</span>
                <button
                  type="button"
                  className="text-zinc-400 hover:text-red-500"
                  onClick={() => void deleteRecipient.mutate(recipient.id)}
                  aria-label="删除收件人"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            ))}
            {(recipients.data ?? []).length === 0 ? (
              <p className="text-xs text-zinc-400">还没有收件人，默认会使用环境变量 MAIL_TO。</p>
            ) : null}
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle title="抓取参数" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="首次接入回溯天数">
              <Input
                type="number"
                value={fetch.lookbackDays}
                onChange={(event) => setFetch({ ...fetch, lookbackDays: Number(event.target.value) })}
              />
            </Field>
            <Field label="单账号每日抓取上限">
              <Input
                type="number"
                value={fetch.dailyLimitPerAccount}
                onChange={(event) => setFetch({ ...fetch, dailyLimitPerAccount: Number(event.target.value) })}
              />
            </Field>
            <Field label="请求间隔（毫秒）" hint="越大越不容易触发风控">
              <Input
                type="number"
                value={fetch.requestDelayMs}
                onChange={(event) => setFetch({ ...fetch, requestDelayMs: Number(event.target.value) })}
              />
            </Field>
            <Field label="公众号搜索服务地址" hint="可选，自建搜索服务；留空则只能用链接绑定">
              <Input
                value={fetch.searchEndpoint}
                onChange={(event) => setFetch({ ...fetch, searchEndpoint: event.target.value })}
                placeholder="https://..."
              />
            </Field>
            <Field label="RSSHub 实例地址" hint="可选，用于 rsshub 类型的账号">
              <Input
                value={fetch.rsshubBaseUrl}
                onChange={(event) => setFetch({ ...fetch, rsshubBaseUrl: event.target.value })}
                placeholder="https://rsshub.example.com"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button loading={updateSettings.isPending} onClick={() => void save({ fetch }, '抓取参数')}>
              保存抓取参数
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

