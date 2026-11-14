"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

const PROFILE = {
  name: "Vince Ryan Alerta",
  photo: "/resume.png",
  networks: "Professional Academy of the Philippines",
  city: "Cebu City",
};

const MAX_MB = 1;
const MAX_SIZE = MAX_MB * 1024 * 1024; // must match the bucket limit
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Shrink big photos in the browser before uploading
async function shrinkImage(file: File, maxDim = 1080, quality = 0.8): Promise<File> {
  if (file.type === "image/gif") return file; // keep GIF animation

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // white behind transparent PNGs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob || blob.size >= file.size) return file; // keep the original if it isn't smaller

  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
}

type Post = {
  id: number;
  author: string;
  content: string;
  image_url: string | null;
  created_at: string;
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// add a post only if it isn't already in the list
function addPost(list: Post[], post: Post) {
  return list.some((p) => p.id === post.id) ? list : [post, ...list];
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("wallbook-name");
    if (saved) setAuthor(saved);

    supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setPosts(data ?? []);
      });

    const channel = supabase
      .channel("posts-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => setPosts((prev) => addPost(prev, payload.new as Post))
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function clearImage() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const picked = input.files?.[0];
    if (!picked) return;

    if (!ALLOWED.includes(picked.type)) {
      setError("Please choose a JPG, PNG, GIF, or WebP image.");
      input.value = "";
      return;
    }

    let f = picked;
    try {
      f = await shrinkImage(picked);
    } catch {
      // if resizing fails, fall back to the original file
    }

    if (f.size > MAX_SIZE) {
      setError(`That image is too big. The limit is ${MAX_MB} MB.`);
      input.value = "";
      return;
    }

    setError("");
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function share(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text && !file) return;

    setBusy(true);
    setError("");
    const name = author.trim() || "Anonymous";

    // 1. upload the image first (if there is one)
    let imageUrl: string | null = null;
    if (file) {
      const ext = file.type.split("/")[1];
      const path = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("post-images")
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        setBusy(false);
        return setError(uploadError.message);
      }
      imageUrl = supabase.storage.from("post-images").getPublicUrl(path).data.publicUrl;
    }

    // 2. save the post with the image link
    const { data, error } = await supabase
      .from("posts")
      .insert({ author: name, content: text, image_url: imageUrl })
      .select()
      .single();

    setBusy(false);
    if (error) return setError(error.message);

    localStorage.setItem("wallbook-name", name);
    setPosts((prev) => addPost(prev, data as Post));
    setContent("");
    clearImage();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">wall</span>
        </div>
      </header>

      <div className="page">
        <aside className="sidebar">
          {PROFILE.photo ? (
            <Image
              className="photo"
              src={PROFILE.photo}
              alt={PROFILE.name}
              width={190}
              height={190}
              priority
            />
          ) : (
            <div className="photo placeholder">{PROFILE.name[0]}</div>
          )}

          <h1 className="profile-name">{PROFILE.name}</h1>
          <button className="info-btn" type="button">Information</button>

          <dl className="info">
            <dt>Networks</dt>
            <dd>{PROFILE.networks}</dd>
            <dt>Current City</dt>
            <dd>{PROFILE.city}</dd>
          </dl>
        </aside>

        <main className="feed">
          <form className="composer" onSubmit={share}>
            <textarea
              placeholder="What's on your mind?"
              value={content}
              maxLength={500}
              onChange={(e) => setContent(e.target.value)}
            />

            {preview && (
              <div className="preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Selected upload preview" />
                <button type="button" className="remove-img" onClick={clearImage}>
                  ✕ Remove
                </button>
              </div>
            )}

            <div className="composer-row">
              <input
                className="name-input"
                placeholder="Your name"
                value={author}
                maxLength={40}
                onChange={(e) => setAuthor(e.target.value)}
              />

              <div className="composer-actions">
                <label className="attach">
                  📷 Photo
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={pickImage}
                    hidden
                  />
                </label>
                <button
                  className="share-btn"
                  disabled={busy || (!content.trim() && !file)}
                >
                  {busy ? "Sharing..." : "Share"}
                </button>
              </div>
            </div>
          </form>

          {error && <p className="error">{error}</p>}

          <ul className="posts">
            {posts.map((p) => (
              <li className="post" key={p.id}>
                <strong className="author">{p.author}</strong>
                {p.content && <p className="content">{p.content}</p>}
                {p.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="post-image" src={p.image_url} alt="" loading="lazy" />
                )}
                <time className="meta">{when(p.created_at)}</time>
              </li>
            ))}
          </ul>

          {posts.length === 0 && !error && (
            <p className="muted">No posts yet. Be the first to write something!</p>
          )}
        </main>
      </div>
    </>
  );
}