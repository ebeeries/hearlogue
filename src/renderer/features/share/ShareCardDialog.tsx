import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Loader2 } from 'lucide-react';
import { Button, Segmented, Switch, cx } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlays';
import { useI18n } from '../../i18n';
import { useAppStore } from '../../stores/app-store';
import { api } from '../../lib/api';
import { renderShareCard, type ShareCardData, type ShareRatio } from './render';

/**
 * Share cards.
 *
 * Rendered to a canvas in the renderer process and handed to the main process
 * only as a data URL when the user asks to save or copy — no image leaves the
 * machine, and nothing is uploaded to produce one. The preview is the same
 * canvas at display scale, so what you see is exactly what is written.
 */

const RATIOS: { value: ShareRatio; labelKey: string }[] = [
  { value: '1:1', labelKey: 'share.ratio.square' },
  { value: '4:5', labelKey: 'share.ratio.portrait' },
  { value: '16:9', labelKey: 'share.ratio.wide' },
];

export function ShareCardDialog({
  open,
  onClose,
  card,
}: {
  open: boolean;
  onClose: () => void;
  card: ShareCardData;
}): JSX.Element {
  const { t } = useI18n();
  const toast = useAppStore((s) => s.toast);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState<ShareRatio>('4:5');
  const [watermark, setWatermark] = useState(true);
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendering(true);
    // A frame's delay lets the dialog paint before the canvas work starts.
    const frame = requestAnimationFrame(() => {
      renderShareCard(canvas, card, ratio, watermark);
      setRendering(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, card, ratio, watermark]);

  const fileName = `${card.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 50)}-hearlogue`;

  const save = async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy('save');
    try {
      const path = await api().system.saveShareCard({
        dataUrl: canvas.toDataURL('image/png'),
        suggestedName: fileName,
      });
      if (path) toast('success', 'share.saved', { path });
    } catch {
      toast('error', 'error.badImage');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy('copy');
    try {
      await api().system.copyShareCard({
        dataUrl: canvas.toDataURL('image/png'),
        suggestedName: fileName,
      });
      toast('success', 'share.copied');
    } catch {
      toast('error', 'error.badImage');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('share.title')}
      description={t('share.subtitle')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="secondary"
            icon={<Copy />}
            loading={busy === 'copy'}
            onClick={() => void copy()}
          >
            {t('share.copy')}
          </Button>
          <Button
            variant="primary"
            icon={<Download />}
            loading={busy === 'save'}
            onClick={() => void save()}
          >
            {t('share.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Segmented
            value={ratio}
            onChange={setRatio}
            options={RATIOS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
          />
          <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-paper-400">
            {t('share.watermark')}
            <Switch checked={watermark} onChange={setWatermark} label={t('share.watermark')} />
          </label>
        </div>

        <div
          className={cx(
            'relative flex items-center justify-center rounded-lg border border-white/[0.07] bg-black/30 p-6',
          )}
        >
          {rendering && (
            <Loader2 aria-hidden className="absolute h-5 w-5 animate-spin text-paper-600" />
          )}
          <canvas
            ref={canvasRef}
            className={cx(
              'max-h-[46vh] w-auto rounded shadow-lift transition-opacity duration-200',
              rendering ? 'opacity-0' : 'opacity-100',
            )}
          />
        </div>
      </div>
    </Modal>
  );
}
