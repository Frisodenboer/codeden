import { ChevronLeft, ChevronRight, Download, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** One image the viewer can show. */
export interface ViewerImage {
  /** An artifact URL or a `data:` URL; both download through `<a download>`. */
  src: string;
  /** Shown as the viewer's title and used as the alt text. */
  name: string;
  /** Shown under the image when it says more than the name. */
  caption?: string;
  /** File name for Download; empty lets the server's file name win. */
  downloadName?: string;
}

interface GalleryContextValue {
  images: ViewerImage[];
  open: (index: number) => void;
  register: (index: number, el: HTMLButtonElement | null) => void;
}

const GalleryContext = createContext<GalleryContextValue | null>(null);

/**
 * Images shown together (one message, one work group, one shared artifact). Every
 * `ImageThumbnail` inside opens the in-app viewer at its own image; with several images the
 * arrow keys step through them. Closing returns focus to the thumbnail of the image shown.
 */
export function ImageGallery({ images, children }: { images: ViewerImage[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const thumbnails = useRef(new Map<number, HTMLButtonElement>());
  const value: GalleryContextValue = {
    images,
    open: (i) => {
      setIndex(i);
      setOpen(true);
    },
    register: (i, el) => {
      if (el) thumbnails.current.set(i, el);
      else thumbnails.current.delete(i);
    },
  };
  return (
    <GalleryContext.Provider value={value}>
      {children}
      <ImageViewer
        images={images}
        index={Math.min(index, images.length - 1)}
        open={open && images.length > 0}
        onIndexChange={setIndex}
        onOpenChange={setOpen}
        returnFocus={() => thumbnails.current.get(index)?.focus()}
      />
    </GalleryContext.Provider>
  );
}

/** A real button around a thumbnail: click, Enter or Space opens the image full screen. */
export function ImageThumbnail({
  index,
  className,
  children,
}: {
  /** Position in the surrounding `ImageGallery`'s images. */
  index: number;
  className?: string;
  children: ReactNode;
}) {
  const gallery = useContext(GalleryContext);
  if (!gallery) throw new Error("ImageThumbnail must be inside an ImageGallery");
  const image = gallery.images[index];
  return (
    <button
      type="button"
      ref={(el) => gallery.register(index, el)}
      aria-label={`View ${image?.name ?? "image"}`}
      title="View full screen"
      onClick={() => gallery.open(index)}
      className={cn(
        "cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Toolbar and arrow buttons on the dark backdrop. */
const onDark = "text-white/80 hover:bg-white/10 hover:text-white dark:hover:bg-white/10";

function ImageViewer({
  images,
  index,
  open,
  onIndexChange,
  onOpenChange,
  returnFocus,
}: {
  images: ViewerImage[];
  index: number;
  open: boolean;
  onIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const image = images[index];
  const many = images.length > 1;
  const step = (by: number) => onIndexChange((index + by + images.length) % images.length);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!many) return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else return;
    e.preventDefault();
  };
  // The content covers the screen, so a click on its empty parts is the backdrop click.
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (e.target instanceof HTMLElement && e.target.dataset.backdrop !== undefined) {
      onOpenChange(false);
    }
  };
  if (!image) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/85 supports-backdrop-filter:backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-testid="image-viewer"
          data-backdrop
          onKeyDown={onKeyDown}
          onClick={onClick}
          // Focus Close rather than Download, so Enter right after opening can't download.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus();
          }}
          // Without a caption there is nothing to describe the dialog with.
          {...(image.caption ? {} : { "aria-describedby": undefined })}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
        >
          <header data-backdrop className="flex shrink-0 items-center gap-3 px-4 py-3">
            <DialogTitle className="min-w-0 truncate text-sm font-medium text-white/90">
              {image.name}
            </DialogTitle>
            {many && (
              <span className="shrink-0 text-xs text-white/60 tabular-nums">
                {index + 1} / {images.length}
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className={onDark} asChild>
                <a href={image.src} download={image.downloadName ?? ""}>
                  <Download /> Download
                </a>
              </Button>
              <DialogPrimitive.Close asChild>
                <Button
                  ref={closeRef}
                  variant="ghost"
                  size="icon-sm"
                  className={onDark}
                  aria-label="Close"
                >
                  <XIcon />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </header>
          <div
            data-backdrop
            className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16"
          >
            <img
              src={image.src}
              alt={image.caption ?? image.name}
              className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
            />
            {many && (
              <>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Previous image"
                  onClick={() => step(-1)}
                  className={cn(onDark, "absolute top-1/2 left-2 -translate-y-1/2 rounded-full")}
                >
                  <ChevronLeft className="size-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Next image"
                  onClick={() => step(1)}
                  className={cn(onDark, "absolute top-1/2 right-2 -translate-y-1/2 rounded-full")}
                >
                  <ChevronRight className="size-6" />
                </Button>
              </>
            )}
          </div>
          {image.caption && (
            <DialogDescription
              data-backdrop
              className="shrink-0 px-4 pb-4 text-center text-xs text-white/70"
            >
              {image.caption}
            </DialogDescription>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
