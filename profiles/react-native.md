# React Native Profile (Expo)

> Patterns for React Native mobile applications with Expo SDK and Expo Router.

---

## Behavioral Mode

**Mobile-first, performance-aware, platform-respectful.**

- Expo SDK for managed features, eject only when necessary
- Respect platform conventions (iOS HIG, Material Design)
- 60fps is the target - use native driver for animations
- Test on real devices, not just simulators

---

## Priorities (Ordered)

1. **Stability** - No crashes, graceful error handling
2. **Performance** - Smooth scrolling, fast interactions
3. **Platform Feel** - iOS feels iOS, Android feels Android
4. **Offline Support** - Handle network failures gracefully
5. **Bundle Size** - Users care about app size

---

## Project Structure

```
app/
├── (tabs)/
│   ├── _layout.tsx       # Tab navigator
│   ├── index.tsx         # Home tab
│   └── profile.tsx       # Profile tab
├── (auth)/
│   ├── _layout.tsx       # Auth stack
│   ├── login.tsx
│   └── register.tsx
├── _layout.tsx           # Root layout
└── +not-found.tsx        # 404 screen
components/
├── ui/                   # Reusable UI components
├── forms/                # Form components
└── [feature]/            # Feature-specific components
lib/
├── api/                  # API clients
├── hooks/                # Custom hooks
├── stores/               # State management
└── utils/                # Utilities
```

---

## Expo Router

### Root Layout
```tsx
// app/_layout.tsx
import { Stack } from 'expo-router'
import { ThemeProvider } from '@react-navigation/native'

export default function RootLayout() {
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  )
}
```

### Tab Navigator
```tsx
// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router'
import { Home, User, Settings } from 'lucide-react-native'

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#007AFF' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Home color={color} size={24} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <User color={color} size={24} />
        }}
      />
    </Tabs>
  )
}
```

### Navigation
```tsx
import { Link, useRouter, useLocalSearchParams } from 'expo-router'

// Declarative navigation
<Link href="/profile/123">View Profile</Link>
<Link href={{ pathname: '/profile/[id]', params: { id: '123' } }}>
  View Profile
</Link>

// Imperative navigation
const router = useRouter()
router.push('/profile/123')
router.replace('/home')
router.back()

// Get params
const { id } = useLocalSearchParams<{ id: string }>()
```

### Deep Linking
```json
// app.json
{
  "expo": {
    "scheme": "myapp",
    "web": {
      "bundler": "metro"
    }
  }
}
```

---

## Styling

### NativeWind (Tailwind for RN)
```tsx
import { View, Text } from 'react-native'

function Card() {
  return (
    <View className="bg-white dark:bg-gray-900 p-4 rounded-xl shadow-md">
      <Text className="text-lg font-semibold text-gray-900 dark:text-white">
        Title
      </Text>
    </View>
  )
}
```

### StyleSheet
```tsx
import { StyleSheet, View, Text } from 'react-native'

function Card() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Title</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3, // Android shadow
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
})
```

---

## Safe Areas

```tsx
import { SafeAreaView } from 'react-native-safe-area-context'

function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <Content />
    </SafeAreaView>
  )
}

// With hooks
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function Header() {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: insets.top }}>
      <HeaderContent />
    </View>
  )
}

// With NativeWind
<View className="flex-1 pt-safe pb-safe">
  <Content />
</View>
```

---

## Platform-Specific Code

### Platform.select()
```tsx
import { Platform, StyleSheet } from 'react-native'

const styles = StyleSheet.create({
  shadow: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    android: {
      elevation: 4,
    },
  }),
})
```

### Platform-Specific Files
```
Button.tsx           # Shared/default
Button.ios.tsx       # iOS-specific
Button.android.tsx   # Android-specific
Button.native.tsx    # Both iOS & Android
Button.web.tsx       # Web-specific
```

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| FlatList slow with many items | Use `@shopify/flash-list` |
| Animations janky | Use `react-native-reanimated` with native driver |
| Keyboard covers input | Use `KeyboardAvoidingView` or `react-native-keyboard-aware-scroll-view` |
| `ScrollView` inside `FlatList` | Never nest scrollables - use `ListHeaderComponent` |
| Text not showing on Android | Wrap in `<Text>` - no raw strings |
| Image not loading | Check `expo-image` and proper URI |
| Safe area overlap | Use `react-native-safe-area-context` |
| Touch target too small | Minimum 44x44 points |
| Slow re-renders | Memoize list items, check `keyExtractor` |

---

## Data Fetching

### React Query / TanStack Query
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.getUser(userId),
  })

  if (isLoading) return <ActivityIndicator />
  if (error) return <ErrorView error={error} />

  return <ProfileView user={data} />
}

function UpdateProfile() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: api.updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] })
    },
  })

  return (
    <Button
      onPress={() => mutation.mutate(data)}
      disabled={mutation.isPending}
    />
  )
}
```

---

## Forms

### React Hook Form
```tsx
import { useForm, Controller } from 'react-hook-form'
import { TextInput, Button, Text, View } from 'react-native'

interface FormData {
  email: string
  password: string
}

function LoginForm() {
  const { control, handleSubmit, formState: { errors } } = useForm<FormData>()

  const onSubmit = (data: FormData) => {
    // Handle login
  }

  return (
    <View>
      <Controller
        control={control}
        name="email"
        rules={{ required: 'Email is required' }}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            placeholder="Email"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        )}
      />
      {errors.email && <Text>{errors.email.message}</Text>}

      <Button title="Login" onPress={handleSubmit(onSubmit)} />
    </View>
  )
}
```

---

## Lists

### FlashList (Performant Lists)
```tsx
import { FlashList } from '@shopify/flash-list'

function ProductList({ products }) {
  return (
    <FlashList
      data={products}
      renderItem={({ item }) => <ProductCard product={item} />}
      estimatedItemSize={200}
      keyExtractor={(item) => item.id}
    />
  )
}
```

### FlatList (Built-in)
```tsx
import { FlatList } from 'react-native'

<FlatList
  data={items}
  renderItem={({ item }) => <Item {...item} />}
  keyExtractor={(item) => item.id}
  ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
  ListEmptyComponent={<EmptyState />}
  onEndReached={loadMore}
  onEndReachedThreshold={0.5}
/>
```

---

## Images

### Expo Image
```tsx
import { Image } from 'expo-image'

function Avatar({ uri }: { uri: string }) {
  return (
    <Image
      source={uri}
      style={{ width: 48, height: 48, borderRadius: 24 }}
      contentFit="cover"
      placeholder={blurhash}
      transition={200}
    />
  )
}
```

---

## Gestures & Animations

### Reanimated
```tsx
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'

function AnimatedBox() {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  const onPress = () => {
    scale.value = withSpring(1.2)
  }

  return (
    <Pressable onPress={onPress}>
      <Animated.View style={[styles.box, animatedStyle]} />
    </Pressable>
  )
}
```

### Gesture Handler
```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated'

function DraggableBox() {
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX
      translateY.value = e.translationY
    })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.box, animatedStyle]} />
    </GestureDetector>
  )
}
```

---

## Expo SDK Modules

```tsx
// Secure storage
import * as SecureStore from 'expo-secure-store'
await SecureStore.setItemAsync('token', value)
const token = await SecureStore.getItemAsync('token')

// Camera
import { CameraView, useCameraPermissions } from 'expo-camera'

// Location
import * as Location from 'expo-location'
const location = await Location.getCurrentPositionAsync()

// Haptics
import * as Haptics from 'expo-haptics'
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

// Notifications
import * as Notifications from 'expo-notifications'
```

---

## Development Commands

```bash
# Start development
npx expo start

# Run on specific platform
npx expo run:ios
npx expo run:android

# Build for production (EAS)
eas build --platform ios
eas build --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android

# Update OTA
eas update --branch production
```

---

## Performance Tips

1. **Use FlashList** over FlatList for large lists
2. **Memoize components** with `React.memo()`
3. **Avoid inline styles** - use StyleSheet
4. **Use Reanimated** for 60fps animations (runs on UI thread)
5. **Optimize images** with expo-image and proper sizing
6. **Profile with React DevTools** and Flipper

---

## Documentation Sources

- **Expo**: [docs.expo.dev](https://docs.expo.dev)
- **Expo Router**: [docs.expo.dev/router](https://docs.expo.dev/router/introduction/)
- **React Native**: [reactnative.dev](https://reactnative.dev)
- **Reanimated**: [docs.swmansion.com/react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/)
- **FlashList**: [shopify.github.io/flash-list](https://shopify.github.io/flash-list/)

---

## Pre-Implementation Checklist

- [ ] Using Expo SDK features where available
- [ ] Platform-specific code for iOS/Android differences
- [ ] Safe areas handled for all screens
- [ ] Animations use native driver / Reanimated
- [ ] Lists use FlashList for performance
- [ ] Touch targets minimum 44x44 points
- [ ] Handles offline/error states
- [ ] Tested on real devices (not just simulator)
