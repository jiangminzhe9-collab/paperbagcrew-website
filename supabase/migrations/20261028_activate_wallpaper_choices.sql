-- Apply only after all 47 new private PNG uploads have passed SHA-256 readback.
-- The guard prevents publishing missing originals.
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='member-wallpapers' AND (name LIKE 'choice/%' OR name LIKE 'launch/%')) <> 53 THEN
  RAISE EXCEPTION 'Expected 53 private wallpaper originals before activation';
 END IF;
END $$;
INSERT INTO public.wallpapers(gallery_id,title,object_path,preview_url,collection) VALUES
(45,'Blue Air','choice/artwork-45.png','/wallpapers/assets/winter-m01.webp','Winter Collection'),
(46,'Forest Walk','choice/artwork-46.png','/wallpapers/assets/winter-m02.webp','Winter Collection'),
(47,'Lodge Break','choice/artwork-47.png','/wallpapers/assets/winter-m03.webp','Winter Collection'),
(48,'Golden Carve','choice/artwork-48.png','/wallpapers/assets/winter-m04.webp','Winter Collection'),
(49,'Rose Ride','choice/artwork-49.png','/wallpapers/assets/winter-f01.webp','Winter Collection'),
(50,'Lavender Wave','choice/artwork-50.png','/wallpapers/assets/winter-f02.webp','Winter Collection'),
(51,'Sky Lift','choice/artwork-51.png','/wallpapers/assets/winter-f03.webp','Winter Collection'),
(52,'Warm Cocoa','choice/artwork-52.png','/wallpapers/assets/winter-f04.webp','Winter Collection'),
(53,'Binding Check','choice/artwork-53.png','/wallpapers/assets/winter-n01.webp','Winter Collection'),
(54,'Alpine Trek','choice/artwork-54.png','/wallpapers/assets/winter-n02.webp','Winter Collection'),
(55,'Snow Friend','choice/artwork-55.png','/wallpapers/assets/winter-n03.webp','Winter Collection'),
(56,'Night Peace','choice/artwork-56.png','/wallpapers/assets/winter-n04.webp','Winter Collection'),
(1,'Nova / Purple Nights','launch/nova-purple.png','/wallpapers/assets/01.webp','Street Players'),
(2,'Mira / Violet Skyline','choice/artwork-2.png','/wallpapers/assets/02.webp','Street Players'),
(3,'Rio / Blue Hour','launch/rio-blue.png','/wallpapers/assets/03.webp','Street Players'),
(4,'Nova / Night Off','choice/artwork-4.png','/wallpapers/assets/04.webp','Street Players'),
(5,'Nova / Sunset','launch/nova-sunset.png','/wallpapers/assets/05.webp','Street Players'),
(6,'Rio / Street Signal','choice/artwork-6.png','/wallpapers/assets/06.webp','Street Players'),
(7,'Mira / Paint the City','choice/artwork-7.png','/wallpapers/assets/07.webp','Street Players'),
(8,'Rio / Street 003','choice/artwork-8.png','/wallpapers/assets/08.webp','Street Players'),
(9,'Mira / Street 002','choice/artwork-9.png','/wallpapers/assets/09.webp','Street Players'),
(11,'City Lights','choice/artwork-11.png','/wallpapers/assets/11.webp','City Moments'),
(12,'Golden Hour','choice/artwork-12.png','/wallpapers/assets/12.webp','City Moments'),
(13,'Rooftop Reverie','choice/artwork-13.png','/wallpapers/assets/13.webp','City Moments'),
(14,'Sunset Watch','choice/artwork-14.png','/wallpapers/assets/14.webp','City Moments'),
(15,'Lantern Lane','choice/artwork-15.png','/wallpapers/assets/15.webp','City Moments'),
(16,'Golden Companion','choice/artwork-16.png','/wallpapers/assets/16.webp','City Moments'),
(17,'Evening Frequency','choice/artwork-17.png','/wallpapers/assets/17.webp','City Moments'),
(18,'Sunset Pause','choice/artwork-18.png','/wallpapers/assets/18.webp','City Moments'),
(19,'Coastal Pause','choice/artwork-19.png','/wallpapers/assets/19.webp','City Moments'),
(21,'Quiet Skyline','choice/artwork-21.png','/wallpapers/assets/21.webp','City Moments'),
(22,'Above the City','choice/artwork-22.png','/wallpapers/assets/22.webp','City Moments'),
(23,'Daylight Explorer','choice/artwork-23.png','/wallpapers/assets/23.webp','City Moments'),
(24,'Courtside Sunset','choice/artwork-24.png','/wallpapers/assets/24.webp','City Moments'),
(25,'Daylight Detour','choice/artwork-25.png','/wallpapers/assets/25.webp','City Moments'),
(26,'One More Game','choice/artwork-26.png','/wallpapers/assets/26.webp','City Moments'),
(27,'Courtside Blue','choice/artwork-27.png','/wallpapers/assets/27.webp','City Moments'),
(28,'Last Light Court','choice/artwork-28.png','/wallpapers/assets/28.webp','City Moments'),
(29,'Platform Eight','choice/artwork-29.png','/wallpapers/assets/29.webp','City Moments'),
(30,'Neon Pause','launch/neon-pause.png','/wallpapers/assets/30.webp','City Moments'),
(31,'Street Ready','choice/artwork-31.png','/wallpapers/assets/31.webp','City Moments'),
(32,'Coffee Break','choice/artwork-32.png','/wallpapers/assets/32.webp','City Moments'),
(33,'Sunset Seat','choice/artwork-33.png','/wallpapers/assets/33.webp','City Moments'),
(34,'Soundtrack to the City','choice/artwork-34.png','/wallpapers/assets/34.webp','City Moments'),
(35,'Skate Spot','choice/artwork-35.png','/wallpapers/assets/35.webp','City Moments'),
(36,'Headphones On','choice/artwork-36.png','/wallpapers/assets/36.webp','City Moments'),
(37,'Take Five','choice/artwork-37.png','/wallpapers/assets/37.webp','City Moments'),
(38,'Moonlit Rooftop','launch/moonlit-rooftop.png','/wallpapers/assets/38.webp','City Moments'),
(40,'Redline Session','choice/artwork-40.png','/wallpapers/assets/40.webp','City Moments'),
(41,'Same Sky','choice/artwork-41.png','/wallpapers/assets/41.webp','Street Editions'),
(42,'Street Edition 001','choice/artwork-42.png','/wallpapers/assets/street-edition-001-v2.webp','Street Editions'),
(43,'Create. Explore. Belong.','choice/artwork-43.png','/wallpapers/assets/43.webp','Street Editions'),
(44,'Midnight Pause','launch/midnight-pause.png','/wallpapers/assets/44.webp','City Moments')
ON CONFLICT(object_path) DO UPDATE SET gallery_id=excluded.gallery_id,title=excluded.title,preview_url=excluded.preview_url,collection=excluded.collection;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.wallpapers w WHERE w.gallery_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='member-wallpapers' AND o.name=w.object_path)) THEN
  RAISE EXCEPTION 'An original is missing';
 END IF;
END $$;
UPDATE public.wallpapers SET published=true WHERE gallery_id IS NOT NULL;
DROP POLICY members_download_published_wallpapers ON storage.objects;
CREATE POLICY members_download_selected_wallpapers ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='member-wallpapers'
 AND coalesce((select auth.jwt())->>'is_anonymous','false')='false'
 AND EXISTS(SELECT 1 FROM public.wallpapers w JOIN public.wallpaper_selections s ON s.wallpaper_id=w.id
 WHERE w.object_path=objects.name AND w.published AND s.user_id=(select auth.uid()))
);
