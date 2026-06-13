"use client";

import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

/** Pan/zoom viewer for a single uploaded map image. */
export function MapView({ url }: { url: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-black/30">
      <TransformWrapper minScale={0.5} maxScale={8} centerOnInit>
        <TransformComponent
          wrapperStyle={{ width: "100%", maxHeight: "75vh" }}
          contentStyle={{ width: "100%" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Map"
            className="mx-auto block w-full select-none object-contain"
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
